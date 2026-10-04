use std::collections::HashMap;
use std::sync::Arc;

use crate::AppState;

use serde::de::DeserializeOwned;
use serde_json::Value;

use super::client::{hue_fetch, HueError};
use super::models::*;
use super::motion::{build_motion_units, MotionInputs};

/// The bridge's resources, split by `type`.
struct Resources(HashMap<String, Vec<Value>>);

impl Resources {
    fn split(all: Vec<Value>) -> Self {
        let mut by_type: HashMap<String, Vec<Value>> = HashMap::new();
        for resource in all {
            let rtype = resource
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned();
            by_type.entry(rtype).or_default().push(resource);
        }
        Self(by_type)
    }

    /// Resources of one type; none when the bridge firmware predates the type.
    fn take<T: DeserializeOwned>(&mut self, rtype: &str) -> Result<Vec<T>, HueError> {
        let items = self.0.remove(rtype).unwrap_or_default();
        serde_json::from_value(Value::Array(items)).map_err(|source| {
            tracing::error!(rtype, error = %source, "Failed to decode Hue resources");
            HueError::DecodeResource {
                rtype: rtype.to_owned(),
                source,
            }
        })
    }
}

pub async fn fetch_hue_data(state: &Arc<AppState>) -> Result<HueResponse, HueError> {
    // Check cache first
    if let Some(cached) = state.hue_cache.get("hue").await {
        tracing::debug!("Returning cached Hue data");
        return Ok(cached);
    }

    let data = fetch_from_bridge(state).await?;
    state.hue_cache.set("hue".into(), data.clone()).await;
    Ok(data)
}

async fn fetch_from_bridge(state: &Arc<AppState>) -> Result<HueResponse, HueError> {
    let room_type_map = build_room_type_map(&state.settings.hue_room_types);

    // One request for everything: the bridge answers a burst of parallel
    // per-type fetches with 429.
    let mut resources =
        Resources::split(hue_fetch::<Value>(state, "/clip/v2/resource").await?.data);
    let rooms: Vec<RoomResource> = resources.take("room")?;
    let temps: Vec<TemperatureResource> = resources.take("temperature")?;
    let grouped_lights: Vec<GroupedLightResource> = resources.take("grouped_light")?;
    let device_powers: Vec<DevicePowerResource> = resources.take("device_power")?;
    let devices: Vec<DeviceResource> = resources.take("device")?;
    let motions: Vec<MotionResource> = resources.take("motion")?;
    let connectivity: Vec<ZigbeeConnectivityResource> = resources.take("zigbee_connectivity")?;
    let areas: Vec<ConvenienceAreaMotionResource> = resources.take("convenience_area_motion")?;
    let area_configs: Vec<MotionAreaConfigurationResource> =
        resources.take("motion_area_configuration")?;
    let grouped_motions: Vec<GroupedMotionResource> = resources.take("grouped_motion")?;
    let service_groups: Vec<ServiceGroupResource> = resources.take("service_group")?;
    let automations: Vec<BehaviorInstanceResource> = resources.take("behavior_instance")?;

    // device ID → battery level
    let battery_by_device: HashMap<&str, u8> = device_powers
        .iter()
        .filter_map(|dp| {
            dp.power_state
                .battery_level
                .map(|b| (dp.owner.rid.as_str(), b))
        })
        .collect();

    // device ID → room
    let room_by_device: HashMap<&str, &RoomResource> = rooms
        .iter()
        .flat_map(|room| {
            room.children
                .iter()
                .filter(|c| c.rtype == "device")
                .map(move |c| (c.rid.as_str(), room))
        })
        .collect();

    // device ID → name
    let device_name_by_id: HashMap<&str, &str> = devices
        .iter()
        .map(|d| (d.id.as_str(), d.metadata.name.as_str()))
        .collect();

    // device ID → connected
    let connected_by_device: HashMap<&str, bool> = connectivity
        .iter()
        .map(|c| (c.owner.rid.as_str(), c.status == "connected"))
        .collect();

    // Build sensors from temperature resources
    let sensors: Vec<Sensor> = temps
        .iter()
        .map(|temp| {
            let room = room_by_device.get(temp.owner.rid.as_str()).copied();
            let room_name = room.map(|r| r.metadata.name.as_str());
            let name = device_name_by_id
                .get(temp.owner.rid.as_str())
                .copied()
                .or(room_name)
                .unwrap_or(&temp.id)
                .to_string();

            let room_type = room_name
                .and_then(|n| {
                    let result = room_type_map.get(n);
                    if result.is_none() {
                        tracing::debug!("Room name '{n}' not found in room type map");
                    }
                    result
                })
                .cloned()
                .unwrap_or(RoomType::Inside);

            let temperature = temp
                .temperature
                .temperature_report
                .as_ref()
                .map(|r| r.temperature)
                .or(temp.temperature.temperature);

            let battery = battery_by_device.get(temp.owner.rid.as_str()).copied();

            Sensor {
                id: temp.id.clone(),
                device_id: temp.owner.rid.clone(),
                name,
                temperature,
                room_type,
                enabled: temp.enabled,
                battery,
                connected: connected_by_device
                    .get(temp.owner.rid.as_str())
                    .copied()
                    .unwrap_or(true),
            }
        })
        .collect();

    // Build groups from grouped lights that belong to rooms
    let room_by_id: HashMap<&str, &RoomResource> =
        rooms.iter().map(|r| (r.id.as_str(), r)).collect();

    let groups: Vec<Group> = grouped_lights
        .iter()
        .filter(|gl| gl.owner.rtype == "room")
        .map(|gl| Group {
            id: gl.id.clone(),
            name: room_by_id
                .get(gl.owner.rid.as_str())
                .map(|r| r.metadata.name.clone())
                .unwrap_or_else(|| gl.id.clone()),
            state: GroupState {
                on: gl.on.on,
                brightness: gl.dimming.as_ref().map(|d| d.brightness),
            },
        })
        .collect();

    let motion_units = build_motion_units(&MotionInputs {
        motions: &motions,
        areas: &areas,
        area_configs: &area_configs,
        grouped: &grouped_motions,
        service_groups: &service_groups,
        automations: &automations,
        device_names: &device_name_by_id,
    });

    Ok(HueResponse {
        sensors,
        groups,
        motion_units,
    })
}

fn build_room_type_map(json_str: &str) -> HashMap<String, RoomType> {
    let mut map = HashMap::new();
    tracing::debug!("Raw HUE_ROOM_TYPES value: '{json_str}'");
    let Ok(config) = serde_json::from_str::<HashMap<String, Vec<String>>>(json_str) else {
        tracing::warn!("Failed to parse HUE_ROOM_TYPES: {json_str}");
        return map;
    };
    tracing::debug!("Room type map parsed: {config:?}");
    for (type_str, rooms) in config {
        let room_type = match type_str.as_str() {
            "inside" => RoomType::Inside,
            "inside_cold" => RoomType::InsideCold,
            "outside" => RoomType::Outside,
            _ => continue,
        };
        for room in rooms {
            map.insert(room, room_type.clone());
        }
    }
    map
}
