pub mod cache;
pub mod hue;
pub mod pv;
pub mod reserve;
pub mod settings;
pub mod solis;
pub mod storage;
pub mod weather;

use std::sync::Arc;

use actix_cors::Cors;
use actix_files::Files;
use actix_web::{middleware, web, App, HttpResponse, HttpServer};
use tokio::sync::broadcast;
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

use cache::Cache;
use settings::Settings;

pub struct AppState {
    pub settings: Settings,
    pub http_client: reqwest::Client,
    pub hue_client: reqwest::Client,
    pub hue_cache: Cache<hue::models::HueResponse>,
    pub tomorrow_cache: Cache<serde_json::Value>,
    pub weather_cache: Cache<weather::models::WeatherResponse>,
    pub solis_cache: Cache<solis::models::SolisWidgetData>,
    pub pv_cache: Cache<pv::models::PvForecast>,
    pub hue_events_tx: broadcast::Sender<hue::events::HueLiveEvent>,
    pub storage: storage::Storage,
}

#[derive(OpenApi)]
#[openapi(
    paths(
        weather::handlers::fmi,
        weather::handlers::tomorrow,
        hue::handlers::get_data,
        hue::handlers::events_sse,
        hue::handlers::pair,
        hue::handlers::toggle_group,
        hue::handlers::set_brightness,
        hue::handlers::toggle_motion,
        solis::handlers::get_data,
        solis::handlers::get_history,
        pv::handlers::get_forecast,
        pv::handlers::post_forecast,
        reserve::handlers::get_reserve,
        status,
        sensor_history,
    ),
    components(schemas(
        hue::models::HueResponse,
        hue::models::Sensor,
        hue::models::Group,
        hue::models::GroupState,
        hue::models::RoomType,
        hue::events::HueLiveEvent,
        hue::handlers::PairRequest,
        hue::handlers::PairResponse,
        hue::handlers::SetBrightnessRequest,
        solis::models::SolisWidgetData,
        solis::models::SolisReading,
        pv::models::PvForecast,
        pv::models::PvPoint,
        reserve::models::ReserveResponse,
        reserve::models::ReservePoint,
        StatusResponse,
        storage::SensorReading,
    ))
)]
struct ApiDoc;

#[derive(serde::Serialize, utoipa::ToSchema)]
struct StatusResponse {
    hue: bool,
    weather: bool,
}

#[derive(serde::Deserialize, utoipa::IntoParams)]
struct SensorHistoryQuery {
    /// Sensor ID to filter by (optional, returns all sensors if omitted)
    sensor_id: Option<String>,
    /// Number of hours of history to return (default: 24, max: 720)
    hours: Option<u32>,
    /// Maximum number of data points to return per sensor via uniform sampling (optional)
    max_points: Option<u32>,
}

#[utoipa::path(
    get,
    path = "/api/history/sensors",
    params(SensorHistoryQuery),
    responses(
        (status = 200, description = "Sensor reading history", body = Vec<storage::SensorReading>),
        (status = 500, description = "Database error")
    )
)]
async fn sensor_history(
    state: web::Data<Arc<AppState>>,
    query: web::Query<SensorHistoryQuery>,
) -> HttpResponse {
    let hours = query.hours.unwrap_or(24).min(720);
    match state
        .storage
        .query_readings(query.sensor_id.as_deref(), hours, query.max_points)
        .await
    {
        Ok(readings) => HttpResponse::Ok().json(readings),
        Err(e) => {
            tracing::error!("Failed to query sensor history: {e}");
            HttpResponse::InternalServerError().finish()
        }
    }
}

#[utoipa::path(
    get,
    path = "/status",
    responses(
        (status = 200, description = "Service health check", body = StatusResponse)
    )
)]
pub async fn status(state: web::Data<Arc<AppState>>) -> HttpResponse {
    let hue = hue::client::check_connection(&state).await;
    let weather = state.weather_cache.has_data().await || state.tomorrow_cache.has_data().await;
    HttpResponse::Ok().json(StatusResponse { hue, weather })
}

async fn get_settings(state: web::Data<Arc<AppState>>) -> HttpResponse {
    match state.storage.get_settings().await {
        Ok(data) => {
            let json: serde_json::Value =
                serde_json::from_str(&data).unwrap_or(serde_json::json!({}));
            HttpResponse::Ok().json(json)
        }
        Err(e) => {
            tracing::error!("Failed to read settings: {e}");
            HttpResponse::InternalServerError().finish()
        }
    }
}

async fn put_settings(
    state: web::Data<Arc<AppState>>,
    body: web::Json<serde_json::Value>,
) -> HttpResponse {
    let data = body.into_inner().to_string();
    match state.storage.save_settings(&data).await {
        Ok(()) => {
            HttpResponse::Ok().json(serde_json::from_str::<serde_json::Value>(&data).unwrap())
        }
        Err(e) => {
            tracing::error!("Failed to save settings: {e}");
            HttpResponse::InternalServerError().finish()
        }
    }
}

pub fn create_app(
    state: Arc<AppState>,
    static_dir: &str,
) -> App<
    impl actix_web::dev::ServiceFactory<
        actix_web::dev::ServiceRequest,
        Config = (),
        Response = actix_web::dev::ServiceResponse<impl actix_web::body::MessageBody>,
        Error = actix_web::Error,
        InitError = (),
    >,
> {
    let openapi = ApiDoc::openapi();
    let static_dir = static_dir.to_string();

    App::new()
        .app_data(web::Data::new(state))
        .wrap(middleware::Logger::default())
        .wrap(Cors::permissive())
        .route("/status", web::get().to(status))
        .service(
            web::scope("/api")
                .service(
                    web::scope("/history")
                        .route("/sensors", web::get().to(sensor_history))
                        .route("/solis", web::get().to(solis::handlers::get_history)),
                )
                .service(
                    web::scope("/settings")
                        .route("", web::get().to(get_settings))
                        .route("", web::put().to(put_settings)),
                )
                .service(
                    web::scope("/weather")
                        .route("/fmi", web::get().to(weather::handlers::fmi))
                        .route("/tomorrow", web::get().to(weather::handlers::tomorrow)),
                )
                .service(
                    web::scope("/hue")
                        .route("", web::get().to(hue::handlers::get_data))
                        .route("/events", web::get().to(hue::handlers::events_sse))
                        .route("/pair", web::post().to(hue::handlers::pair))
                        .route(
                            "/toggleGroup/{id}",
                            web::post().to(hue::handlers::toggle_group),
                        )
                        .route(
                            "/setBrightness/{id}",
                            web::post().to(hue::handlers::set_brightness),
                        )
                        .route(
                            "/toggleMotion/{deviceId}",
                            web::post().to(hue::handlers::toggle_motion),
                        ),
                )
                .service(web::scope("/solis").route("", web::get().to(solis::handlers::get_data)))
                .service(
                    web::scope("/pv").service(
                        web::resource("/forecast")
                            .route(web::get().to(pv::handlers::get_forecast))
                            .route(web::post().to(pv::handlers::post_forecast)),
                    ),
                )
                .service(
                    web::scope("/reserve").route("", web::get().to(reserve::handlers::get_reserve)),
                ),
        )
        .service(SwaggerUi::new("/docs/{_:.*}").url("/api-doc/openapi.json", openapi))
        .service({
            let index_path = format!("{static_dir}/index.html");
            Files::new("/", &static_dir)
                .index_file("index.html")
                .default_handler(actix_web::dev::fn_service(
                    move |req: actix_web::dev::ServiceRequest| {
                        let index_path = index_path.clone();
                        async move {
                            let (req, _) = req.into_parts();
                            let file = actix_files::NamedFile::open_async(&index_path).await?;
                            let res = file.into_response(&req);
                            Ok(actix_web::dev::ServiceResponse::new(req, res))
                        }
                    },
                ))
        })
}

pub fn create_test_app_state() -> Arc<AppState> {
    create_test_app_state_with(Settings::test_defaults())
}

pub fn create_test_app_state_with(settings: Settings) -> Arc<AppState> {
    let hue_client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .build()
        .expect("Failed to build Hue HTTP client");

    let (hue_events_tx, _) = broadcast::channel(256);
    let storage = storage::Storage::open(std::path::Path::new(":memory:"))
        .expect("Failed to open in-memory SQLite database");

    Arc::new(AppState {
        settings,
        http_client: reqwest::Client::new(),
        hue_client,
        hue_cache: Cache::new(std::time::Duration::from_secs(3)),
        tomorrow_cache: Cache::new(std::time::Duration::from_secs(3600)),
        weather_cache: Cache::new(std::time::Duration::from_secs(3600)),
        solis_cache: Cache::new(std::time::Duration::from_secs(300)),
        pv_cache: Cache::new(std::time::Duration::from_secs(60)),
        hue_events_tx,
        storage,
    })
}

pub async fn run_server() -> std::io::Result<()> {
    dotenvy::dotenv().ok();

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let settings = Settings::from_env();
    let port = settings.port;
    let static_dir = settings.static_dir.clone();

    let hue_client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .build()
        .expect("Failed to build Hue HTTP client");

    let (hue_events_tx, _) = broadcast::channel(256);

    let db_path = std::env::var("HALO_DB_PATH").unwrap_or_else(|_| "halo.db".into());
    let storage = storage::Storage::open(std::path::Path::new(&db_path))
        .expect("Failed to open SQLite database");

    let state = Arc::new(AppState {
        settings,
        http_client: reqwest::Client::new(),
        hue_client,
        hue_cache: Cache::new(std::time::Duration::from_secs(3)),
        tomorrow_cache: Cache::new(std::time::Duration::from_secs(3600)),
        weather_cache: Cache::new(std::time::Duration::from_secs(3600)),
        solis_cache: Cache::new(std::time::Duration::from_secs(300)),
        pv_cache: Cache::new(std::time::Duration::from_secs(60)),
        hue_events_tx: hue_events_tx.clone(),
        storage,
    });

    hue::events::start_stream_loop(state.clone());
    storage::start_recording_loop(state.clone());
    solis::recording::start(state.clone());

    tracing::info!("Starting server on port {port}");

    HttpServer::new(move || create_app(state.clone(), &static_dir))
        .bind(("0.0.0.0", port))?
        .run()
        .await
}
