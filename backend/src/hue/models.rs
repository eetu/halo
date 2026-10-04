use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

// ---- Public response types (match Next.js /api/hue shape) ----

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct HueResponse {
    pub sensors: Vec<Sensor>,
    pub groups: Vec<Group>,
    pub motion_units: Vec<MotionUnit>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Sensor {
    pub id: String,
    pub device_id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f64>,
    #[serde(rename = "type")]
    pub room_type: RoomType,
    pub enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub battery: Option<u8>,
    pub connected: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct Group {
    pub id: String,
    pub name: String,
    pub state: GroupState,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct GroupState {
    pub on: bool,
    /// Brightness percentage (0..=100). Hue reports it independently of `on`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub brightness: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum RoomType {
    Inside,
    InsideCold,
    Outside,
}

/// What one motion automation listens to: a Hue service group, or a sensor or
/// MotionAware area on its own. See `hue::motion`.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MotionUnit {
    /// Service group ID, or the lone member's service ID.
    pub id: String,
    pub name: String,
    /// Service whose motion stands for the whole unit (`grouped_motion` for a
    /// group). Live `motion` events carry this ID.
    pub motion_service_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub motion: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub motion_updated_at: Option<String>,
    pub members: Vec<MotionMember>,
    /// Absent when no automation with a daylight setting listens to the unit.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub daylight: Option<Daylight>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MotionMember {
    /// `motion` or `convenience_area_motion` service ID.
    pub id: String,
    pub kind: MotionMemberKind,
    pub name: String,
    pub enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sensitivity: Option<Sensitivity>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum MotionMemberKind {
    /// A motion sensor device.
    Sensor,
    /// MotionAware light fixtures sensing as one area.
    Area,
}

impl MotionMemberKind {
    pub fn resource_path(self, id: &str) -> String {
        match self {
            Self::Sensor => format!("/clip/v2/resource/motion/{id}"),
            Self::Area => format!("/clip/v2/resource/convenience_area_motion/{id}"),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, ToSchema)]
pub struct Sensitivity {
    /// 0..=max; the scale differs between sensor models.
    pub value: u8,
    pub max: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Daylight {
    /// The automation (`behavior_instance`) holding the setting.
    pub automation_id: String,
    /// Hue light level (10000·log10(lux) + 1) below which motion counts as
    /// dark. `null` when the automation ignores daylight.
    pub dark_threshold: Option<u32>,
}

// ---- CLIP v2 resource shapes (for deserialization from bridge) ----

#[derive(Debug, Deserialize)]
pub struct HueList<T> {
    pub data: Vec<T>,
}

#[derive(Debug, Deserialize)]
pub struct RoomResource {
    pub id: String,
    pub metadata: Metadata,
    pub children: Vec<ResourceRef>,
}

#[derive(Debug, Deserialize)]
pub struct Metadata {
    pub name: String,
}

#[derive(Debug, Deserialize)]
pub struct ResourceRef {
    pub rid: String,
    pub rtype: String,
}

#[derive(Debug, Deserialize)]
pub struct TemperatureResource {
    pub id: String,
    pub owner: Owner,
    pub enabled: bool,
    pub temperature: TemperatureData,
}

#[derive(Debug, Deserialize)]
pub struct TemperatureData {
    /// Absent on disabled temperature sensors — only `temperature_valid` is emitted then.
    pub temperature: Option<f64>,
    pub temperature_report: Option<TemperatureReport>,
}

#[derive(Debug, Deserialize)]
pub struct TemperatureReport {
    pub temperature: f64,
}

#[derive(Debug, Deserialize)]
pub struct Owner {
    pub rid: String,
}

#[derive(Debug, Deserialize)]
pub struct GroupedLightResource {
    pub id: String,
    pub owner: GroupedLightOwner,
    pub on: OnState,
    pub dimming: Option<DimmingState>,
}

#[derive(Debug, Deserialize)]
pub struct DimmingState {
    pub brightness: f64,
}

#[derive(Debug, Deserialize)]
pub struct GroupedLightOwner {
    pub rid: String,
    pub rtype: String,
}

#[derive(Debug, Deserialize)]
pub struct OnState {
    pub on: bool,
}

#[derive(Debug, Deserialize)]
pub struct DeviceResource {
    pub id: String,
    pub metadata: Metadata,
}

#[derive(Debug, Deserialize)]
pub struct DevicePowerResource {
    pub owner: Owner,
    pub power_state: PowerState,
}

#[derive(Debug, Deserialize)]
pub struct PowerState {
    pub battery_level: Option<u8>,
}

#[derive(Debug, Deserialize)]
pub struct MotionResource {
    pub id: String,
    pub owner: Owner,
    pub enabled: bool,
    pub motion: MotionData,
    pub sensitivity: Option<SensitivityData>,
}

#[derive(Debug, Deserialize)]
pub struct ConvenienceAreaMotionResource {
    pub id: String,
    /// The `motion_area_configuration` the area belongs to.
    pub owner: Owner,
    pub enabled: bool,
    #[serde(default)]
    pub motion: MotionData,
    pub sensitivity: Option<SensitivityData>,
}

#[derive(Debug, Deserialize)]
pub struct MotionAreaConfigurationResource {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Deserialize)]
pub struct GroupedMotionResource {
    pub id: String,
    #[serde(default)]
    pub motion: MotionData,
}

#[derive(Debug, Deserialize)]
pub struct ServiceGroupResource {
    pub id: String,
    pub metadata: Option<Metadata>,
    pub children: Vec<ResourceRef>,
    pub services: Vec<ResourceRef>,
}

#[derive(Debug, Deserialize)]
pub struct BehaviorInstanceResource {
    pub id: String,
    #[serde(default)]
    pub configuration: serde_json::Value,
}

#[derive(Debug, Deserialize)]
pub struct SensitivityData {
    pub sensitivity: Option<u8>,
    pub sensitivity_max: Option<u8>,
}

#[derive(Debug, Default, Deserialize)]
pub struct MotionData {
    /// Absent on disabled motion sensors — only `motion_valid` is emitted then.
    pub motion: Option<bool>,
    pub motion_report: Option<MotionReport>,
}

#[derive(Debug, Deserialize)]
pub struct MotionReport {
    pub motion: bool,
    pub changed: String,
}

#[derive(Debug, Deserialize)]
pub struct ZigbeeConnectivityResource {
    pub owner: Owner,
    pub status: String,
}
