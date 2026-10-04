use actix_web::{test, web, App};
use halo_backend::settings::Settings;
use halo_backend::{create_test_app_state, create_test_app_state_with, hue, weather};
use wiremock::matchers::{body_json, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

/// Build a test app with only the API routes (no static file serving).
fn test_app(
    state: std::sync::Arc<halo_backend::AppState>,
) -> App<
    impl actix_web::dev::ServiceFactory<
        actix_web::dev::ServiceRequest,
        Config = (),
        Response = actix_web::dev::ServiceResponse<impl actix_web::body::MessageBody>,
        Error = actix_web::Error,
        InitError = (),
    >,
> {
    App::new()
        .app_data(web::Data::new(state))
        .route("/status", web::get().to(halo_backend::status))
        .service(
            web::scope("/api")
                .service(
                    web::scope("/weather")
                        .route("/fmi", web::get().to(weather::handlers::fmi))
                        .route("/tomorrow", web::get().to(weather::handlers::tomorrow)),
                )
                .service(
                    web::scope("/hue")
                        .route("", web::get().to(hue::handlers::get_data))
                        .route("/pair", web::post().to(hue::handlers::pair))
                        .route(
                            "/toggleGroup/{id}",
                            web::post().to(hue::handlers::toggle_group),
                        )
                        .route(
                            "/setMotionEnabled/{id}",
                            web::post().to(hue::handlers::set_motion_enabled),
                        )
                        .route(
                            "/setMotionSensitivity/{id}",
                            web::post().to(hue::handlers::set_motion_sensitivity),
                        )
                        .route(
                            "/setDaylight/{automationId}",
                            web::post().to(hue::handlers::set_daylight),
                        ),
                ),
        )
}

fn test_settings_with_mock(mock_url: &str) -> Settings {
    Settings {
        pv_array: None,
        tomorrow_io_api_key: "test-key".into(),
        tomorrow_io_base_url: mock_url.into(),
        fmi_base_url: mock_url.into(),
        fmi_wms_base_url: mock_url.into(),
        fmi_download_base_url: mock_url.into(),
        language: "fi".into(),
        hue_bridge_address: mock_url.into(),
        hue_bridge_user: "test-user".into(),
        hue_room_types: "{}".into(),
        static_dir: "./dist".into(),
        port: 3000,
        history_retention_days: 90,
        solis_base_url: "".into(),
        solis_key_id: "".into(),
        solis_key_secret: "".into(),
        solis_station_id: "".into(),
        reserve_provider: "reserve".into(),
        spot_base_url: mock_url.into(),
    }
}

// ---- Status endpoint ----

#[actix_web::test]
async fn status_returns_200() {
    let state = create_test_app_state();
    let app = test::init_service(test_app(state)).await;
    let req = test::TestRequest::get().uri("/status").to_request();
    let resp = test::call_service(&app, req).await;

    assert_eq!(resp.status(), 200);

    let body: serde_json::Value = test::read_body_json(resp).await;
    assert!(body.get("hue").is_some());
    assert!(body.get("weather").is_some());
}

#[actix_web::test]
async fn status_reports_services_down_without_config() {
    let state = create_test_app_state();
    let app = test::init_service(test_app(state)).await;
    let req = test::TestRequest::get().uri("/status").to_request();
    let resp = test::call_service(&app, req).await;

    let body: serde_json::Value = test::read_body_json(resp).await;
    assert_eq!(body["hue"], false);
    assert_eq!(body["weather"], false);
}

#[actix_web::test]
async fn status_reports_hue_up_with_mock_bridge() {
    let mock_server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/clip/v2/resource/bridge"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "data": [{"id": "bridge-1"}]
        })))
        .mount(&mock_server)
        .await;

    let settings = test_settings_with_mock(&mock_server.uri());
    let state = create_test_app_state_with(settings);
    let app = test::init_service(test_app(state)).await;

    let req = test::TestRequest::get().uri("/status").to_request();
    let resp = test::call_service(&app, req).await;

    let body: serde_json::Value = test::read_body_json(resp).await;
    assert_eq!(body["hue"], true);
}

// ---- Weather endpoint ----

#[actix_web::test]
async fn weather_returns_data_from_api() {
    let mock_server = MockServer::start().await;

    let weather_data = serde_json::json!({
        "data": {"timelines": []}
    });

    Mock::given(method("GET"))
        .and(path("/v4/timelines"))
        .respond_with(ResponseTemplate::new(200).set_body_json(&weather_data))
        .mount(&mock_server)
        .await;

    let settings = test_settings_with_mock(&mock_server.uri());
    let state = create_test_app_state_with(settings);
    let app = test::init_service(test_app(state)).await;

    let req = test::TestRequest::get()
        .uri("/api/weather/tomorrow?lat=1&lon=1")
        .to_request();
    let resp = test::call_service(&app, req).await;

    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = test::read_body_json(resp).await;
    assert_eq!(body, weather_data);
}

#[actix_web::test]
async fn weather_returns_502_when_api_fails() {
    let mock_server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/v4/timelines"))
        .respond_with(ResponseTemplate::new(500))
        .mount(&mock_server)
        .await;

    let settings = test_settings_with_mock(&mock_server.uri());
    let state = create_test_app_state_with(settings);
    let app = test::init_service(test_app(state)).await;

    let req = test::TestRequest::get()
        .uri("/api/weather/tomorrow?lat=1&lon=1")
        .to_request();
    let resp = test::call_service(&app, req).await;

    assert_eq!(resp.status(), 502);
}

#[actix_web::test]
async fn weather_returns_cached_data() {
    let state = create_test_app_state();
    let cached = serde_json::json!({"test": "weather_data"});

    state
        .tomorrow_cache
        .set("1,1".to_owned(), cached.clone())
        .await;

    let app = test::init_service(test_app(state)).await;

    let req = test::TestRequest::get()
        .uri("/api/weather/tomorrow?lat=1&lon=1")
        .to_request();
    let resp = test::call_service(&app, req).await;

    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = test::read_body_json(resp).await;
    assert_eq!(body["test"], "weather_data");
}

#[actix_web::test]
async fn weather_serves_from_cache_over_api() {
    let mock_server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/v4/timelines"))
        .respond_with(ResponseTemplate::new(500))
        .expect(0) // Should not be called when cache is fresh
        .mount(&mock_server)
        .await;

    let settings = test_settings_with_mock(&mock_server.uri());
    let state = create_test_app_state_with(settings);
    state
        .tomorrow_cache
        .set("1,1".to_owned(), serde_json::json!({"cached": true}))
        .await;

    let app = test::init_service(test_app(state)).await;

    let req = test::TestRequest::get()
        .uri("/api/weather/tomorrow?lat=1&lon=1")
        .to_request();
    let resp = test::call_service(&app, req).await;

    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = test::read_body_json(resp).await;
    assert_eq!(body["cached"], true);
}

// ---- Hue endpoints ----

#[actix_web::test]
async fn hue_get_returns_error_without_credentials() {
    let state = create_test_app_state();
    let app = test::init_service(test_app(state)).await;
    let req = test::TestRequest::get().uri("/api/hue").to_request();
    let resp = test::call_service(&app, req).await;

    assert_eq!(resp.status(), 502);
}

#[actix_web::test]
async fn hue_get_returns_data_from_bridge() {
    let mock_server = MockServer::start().await;

    // No motion area types, as on firmware that predates them; a scene the
    // dashboard ignores.
    Mock::given(method("GET"))
        .and(path("/clip/v2/resource"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(serde_json::json!({"data": [
                {"id": "d1", "type": "device", "metadata": {"name": "Käytävä"}},
                {"id": "m1", "type": "motion", "owner": {"rid": "d1"}, "enabled": true,
                 "motion": {"motion": false}},
                {"id": "s1", "type": "scene", "metadata": {"name": "Ilta"}},
            ]})),
        )
        .expect(1)
        .mount(&mock_server)
        .await;

    let settings = test_settings_with_mock(&mock_server.uri());
    let state = create_test_app_state_with(settings);
    let app = test::init_service(test_app(state)).await;

    let req = test::TestRequest::get().uri("/api/hue").to_request();
    let resp = test::call_service(&app, req).await;

    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = test::read_body_json(resp).await;
    assert!(body["sensors"].as_array().unwrap().is_empty());
    assert!(body["groups"].as_array().unwrap().is_empty());
    assert_eq!(body["motionUnits"][0]["name"], "Käytävä");
    assert_eq!(body["motionUnits"][0]["members"][0]["kind"], "sensor");
}

#[actix_web::test]
async fn hue_get_returns_cached_data() {
    let state = create_test_app_state();
    let cached = hue::models::HueResponse {
        sensors: vec![],
        groups: vec![hue::models::Group {
            id: "g1".into(),
            name: "Living Room".into(),
            state: hue::models::GroupState {
                on: true,
                brightness: Some(80.0),
            },
        }],
        motion_units: vec![],
    };
    state.hue_cache.set("hue".to_owned(), cached).await;

    let app = test::init_service(test_app(state)).await;
    let req = test::TestRequest::get().uri("/api/hue").to_request();
    let resp = test::call_service(&app, req).await;

    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = test::read_body_json(resp).await;
    assert_eq!(body["groups"][0]["name"], "Living Room");
}

#[actix_web::test]
async fn hue_pair_requires_bridge_ip() {
    let state = create_test_app_state();
    let app = test::init_service(test_app(state)).await;
    let req = test::TestRequest::post()
        .uri("/api/hue/pair")
        .set_json(serde_json::json!({}))
        .to_request();
    let resp = test::call_service(&app, req).await;

    assert_eq!(resp.status(), 400);
    let body: serde_json::Value = test::read_body_json(resp).await;
    assert!(body["error"].as_str().unwrap().contains("bridgeIp"));
}

#[actix_web::test]
async fn hue_pair_successful() {
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/api"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([
            {"success": {"username": "test-user-123", "clientkey": "test-key-456"}}
        ])))
        .mount(&mock_server)
        .await;

    let state = create_test_app_state();
    let app = test::init_service(test_app(state)).await;

    let req = test::TestRequest::post()
        .uri("/api/hue/pair")
        .set_json(serde_json::json!({"bridgeIp": mock_server.uri()}))
        .to_request();
    let resp = test::call_service(&app, req).await;

    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = test::read_body_json(resp).await;
    assert_eq!(body["HUE_BRIDGE_USER"], "test-user-123");
    assert_eq!(body["HUE_BRIDGE_USER_CLIENT_KEY"], "test-key-456");
}

#[actix_web::test]
async fn hue_pair_button_not_pressed() {
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/api"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([
            {"error": {"type": 101, "description": "link button not pressed"}}
        ])))
        .mount(&mock_server)
        .await;

    let state = create_test_app_state();
    let app = test::init_service(test_app(state)).await;

    let req = test::TestRequest::post()
        .uri("/api/hue/pair")
        .set_json(serde_json::json!({"bridgeIp": mock_server.uri()}))
        .to_request();
    let resp = test::call_service(&app, req).await;

    assert_eq!(resp.status(), 400);
    let body: serde_json::Value = test::read_body_json(resp).await;
    assert!(body["error"]
        .as_str()
        .unwrap()
        .contains("link button not pressed"));
}

#[actix_web::test]
async fn hue_toggle_returns_error_without_credentials() {
    let state = create_test_app_state();
    let app = test::init_service(test_app(state)).await;
    let req = test::TestRequest::post()
        .uri("/api/hue/toggleGroup/some-id")
        .to_request();
    let resp = test::call_service(&app, req).await;

    assert_eq!(resp.status(), 502);
}

#[actix_web::test]
async fn hue_toggle_toggles_group() {
    let mock_server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/clip/v2/resource/grouped_light/group-1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "data": [{"id": "group-1", "owner": {"rid": "room-1", "rtype": "room"}, "on": {"on": true}}]
        })))
        .mount(&mock_server)
        .await;

    Mock::given(method("PUT"))
        .and(path("/clip/v2/resource/grouped_light/group-1"))
        .respond_with(ResponseTemplate::new(200))
        .mount(&mock_server)
        .await;

    let settings = test_settings_with_mock(&mock_server.uri());
    let state = create_test_app_state_with(settings);
    let app = test::init_service(test_app(state)).await;

    let req = test::TestRequest::post()
        .uri("/api/hue/toggleGroup/group-1")
        .to_request();
    let resp = test::call_service(&app, req).await;

    assert_eq!(resp.status(), 200);
}

async fn post_json(
    state: std::sync::Arc<halo_backend::AppState>,
    uri: &str,
    body: serde_json::Value,
) -> u16 {
    let app = test::init_service(test_app(state)).await;
    let req = test::TestRequest::post()
        .uri(uri)
        .set_json(body)
        .to_request();
    test::call_service(&app, req).await.status().as_u16()
}

#[actix_web::test]
async fn hue_set_motion_enabled_writes_to_the_member_kind() {
    let mock_server = MockServer::start().await;
    let put_mock = Mock::given(method("PUT"))
        .and(path("/clip/v2/resource/convenience_area_motion/a1"))
        .and(body_json(serde_json::json!({"enabled": false})))
        .respond_with(ResponseTemplate::new(200))
        .expect(1)
        .mount_as_scoped(&mock_server)
        .await;

    let state = create_test_app_state_with(test_settings_with_mock(&mock_server.uri()));
    let status = post_json(
        state,
        "/api/hue/setMotionEnabled/a1",
        serde_json::json!({"kind": "area", "enabled": false}),
    )
    .await;

    assert_eq!(status, 200);
    drop(put_mock);
}

#[actix_web::test]
async fn hue_set_motion_sensitivity_writes_the_level() {
    let mock_server = MockServer::start().await;
    let put_mock = Mock::given(method("PUT"))
        .and(path("/clip/v2/resource/motion/b2"))
        .and(body_json(
            serde_json::json!({"sensitivity": {"sensitivity": 3}}),
        ))
        .respond_with(ResponseTemplate::new(200))
        .expect(1)
        .mount_as_scoped(&mock_server)
        .await;

    let state = create_test_app_state_with(test_settings_with_mock(&mock_server.uri()));
    let status = post_json(
        state,
        "/api/hue/setMotionSensitivity/b2",
        serde_json::json!({"kind": "sensor", "sensitivity": 3}),
    )
    .await;

    assert_eq!(status, 200);
    drop(put_mock);
}

#[actix_web::test]
async fn hue_motion_setters_reject_ids_that_are_not_resource_ids() {
    let state = create_test_app_state();
    let status = post_json(
        state,
        "/api/hue/setMotionEnabled/room",
        serde_json::json!({"kind": "sensor", "enabled": true}),
    )
    .await;

    assert_eq!(status, 400);
}

fn automation(daylight: bool) -> serde_json::Value {
    let mut configuration = serde_json::json!({
        "motion": {"motion_service": {"rid": "c3", "rtype": "motion"}},
        "source": {"rid": "d4", "rtype": "device"},
    });
    if daylight {
        configuration["light_level"] = serde_json::json!({"daylight": {"daylight_sensitivity": {
            "settings": {"dark_threshold": 14477, "offset": 7000},
        }}});
    }
    serde_json::json!({"data": [{"id": "e5", "type": "behavior_instance", "configuration": configuration}]})
}

#[actix_web::test]
async fn hue_set_daylight_writes_back_the_whole_configuration() {
    let mock_server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/clip/v2/resource/behavior_instance/e5"))
        .respond_with(ResponseTemplate::new(200).set_body_json(automation(true)))
        .mount(&mock_server)
        .await;

    let mut expected = automation(true)["data"][0]["configuration"].clone();
    expected["light_level"]["daylight"]["daylight_sensitivity"]["settings"]["dark_threshold"] =
        serde_json::json!(65534);
    let put_mock = Mock::given(method("PUT"))
        .and(path("/clip/v2/resource/behavior_instance/e5"))
        .and(body_json(serde_json::json!({"configuration": expected})))
        .respond_with(ResponseTemplate::new(200))
        .expect(1)
        .mount_as_scoped(&mock_server)
        .await;

    let state = create_test_app_state_with(test_settings_with_mock(&mock_server.uri()));
    let status = post_json(
        state,
        "/api/hue/setDaylight/e5",
        serde_json::json!({"darkThreshold": null}),
    )
    .await;

    assert_eq!(status, 200);
    drop(put_mock);
}

#[actix_web::test]
async fn hue_set_daylight_refuses_automation_without_daylight() {
    let mock_server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/clip/v2/resource/behavior_instance/e5"))
        .respond_with(ResponseTemplate::new(200).set_body_json(automation(false)))
        .mount(&mock_server)
        .await;
    let put_mock = Mock::given(method("PUT"))
        .respond_with(ResponseTemplate::new(200))
        .expect(0)
        .mount_as_scoped(&mock_server)
        .await;

    let state = create_test_app_state_with(test_settings_with_mock(&mock_server.uri()));
    let status = post_json(
        state,
        "/api/hue/setDaylight/e5",
        serde_json::json!({"darkThreshold": 20000}),
    )
    .await;

    assert_eq!(status, 409);
    drop(put_mock);
}

// ---- Routing ----

#[actix_web::test]
async fn unknown_api_route_returns_404() {
    let state = create_test_app_state();
    let app = test::init_service(test_app(state)).await;
    let req = test::TestRequest::get()
        .uri("/api/nonexistent")
        .to_request();
    let resp = test::call_service(&app, req).await;

    assert_eq!(resp.status(), 404);
}
