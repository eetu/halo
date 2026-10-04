//! Motion units: what each motion automation listens to.
//!
//! A Hue `service_group` joins motion sensors and MotionAware areas behind one
//! `grouped_motion`, and the automation on that service carries one daylight
//! setting for all of them, so the group is the unit. Members keep their own
//! sensitivity. Sensors and areas outside any service group are units of their
//! own. The `grouped_motion` the bridge gives every room is not a unit.

use std::collections::{HashMap, HashSet};

use serde_json::Value;

use super::models::*;

/// Where a motion automation names the service it listens to.
const MOTION_SERVICE_RID_POINTER: &str = "/motion/motion_service/rid";

/// Where a motion automation keeps its daylight threshold.
pub const DARK_THRESHOLD_POINTER: &str =
    "/light_level/daylight/daylight_sensitivity/settings/dark_threshold";

/// The `dark_threshold` of an automation that ignores daylight: the top of the
/// light level scale, so it is always dark.
pub const DAYLIGHT_OFF: u32 = 65534;

pub struct MotionInputs<'a> {
    pub motions: &'a [MotionResource],
    pub areas: &'a [ConvenienceAreaMotionResource],
    pub area_configs: &'a [MotionAreaConfigurationResource],
    pub grouped: &'a [GroupedMotionResource],
    pub service_groups: &'a [ServiceGroupResource],
    pub automations: &'a [BehaviorInstanceResource],
    /// device ID → name
    pub device_names: &'a HashMap<&'a str, &'a str>,
}

/// A member plus its own motion state, used when it stands alone.
struct Candidate<'a> {
    member: MotionMember,
    motion: &'a MotionData,
}

pub fn build_motion_units(inputs: &MotionInputs) -> Vec<MotionUnit> {
    let area_names: HashMap<&str, &str> = inputs
        .area_configs
        .iter()
        .map(|c| (c.id.as_str(), c.name.as_str()))
        .collect();

    let mut candidates: Vec<Candidate> = inputs
        .motions
        .iter()
        .map(|m| Candidate {
            member: MotionMember {
                id: m.id.clone(),
                kind: MotionMemberKind::Sensor,
                name: inputs
                    .device_names
                    .get(m.owner.rid.as_str())
                    .map_or_else(|| m.id.clone(), |n| (*n).to_string()),
                enabled: m.enabled,
                sensitivity: m.sensitivity.as_ref().and_then(sensitivity),
            },
            motion: &m.motion,
        })
        .collect();
    candidates.extend(inputs.areas.iter().map(|a| {
        Candidate {
            member: MotionMember {
                id: a.id.clone(),
                kind: MotionMemberKind::Area,
                name: area_names
                    .get(a.owner.rid.as_str())
                    .map_or_else(|| a.id.clone(), |n| (*n).to_string()),
                enabled: a.enabled,
                sensitivity: a.sensitivity.as_ref().and_then(sensitivity),
            },
            motion: &a.motion,
        }
    }));

    let daylight_by_service = daylight_by_service(inputs.automations);
    let grouped_by_id: HashMap<&str, &GroupedMotionResource> =
        inputs.grouped.iter().map(|g| (g.id.as_str(), g)).collect();

    let mut units = Vec::new();
    let mut grouped_members = HashSet::new();

    for group in inputs.service_groups {
        let Some(grouped) = group
            .services
            .iter()
            .find(|s| s.rtype == "grouped_motion")
            .and_then(|s| grouped_by_id.get(s.rid.as_str()))
        else {
            continue;
        };
        let members: Vec<MotionMember> = group
            .children
            .iter()
            .filter_map(|child| candidates.iter().find(|c| c.member.id == child.rid))
            .map(|c| c.member.clone())
            .collect();
        if members.is_empty() {
            continue;
        }
        grouped_members.extend(members.iter().map(|m| m.id.clone()));

        let (motion, motion_updated_at) = motion_state(&grouped.motion);
        units.push(MotionUnit {
            id: group.id.clone(),
            name: group
                .metadata
                .as_ref()
                .map_or_else(|| group.id.clone(), |m| m.name.clone()),
            motion_service_id: grouped.id.clone(),
            motion,
            motion_updated_at,
            members,
            daylight: daylight_by_service.get(grouped.id.as_str()).cloned(),
        });
    }

    candidates.retain(|c| !grouped_members.contains(&c.member.id));
    units.extend(candidates.into_iter().map(|c| {
        let (motion, motion_updated_at) = motion_state(c.motion);
        MotionUnit {
            id: c.member.id.clone(),
            name: c.member.name.clone(),
            motion_service_id: c.member.id.clone(),
            motion,
            motion_updated_at,
            daylight: daylight_by_service.get(c.member.id.as_str()).cloned(),
            members: vec![c.member],
        }
    }));

    units.sort_by_cached_key(|u| u.name.to_lowercase());
    units
}

/// The daylight setting of an automation's configuration: `None` when it has
/// none, `Some(None)` when it ignores daylight.
pub fn dark_threshold(configuration: &Value) -> Option<Option<u32>> {
    let threshold = configuration.pointer(DARK_THRESHOLD_POINTER)?.as_u64()?;
    let threshold = u32::try_from(threshold).unwrap_or(DAYLIGHT_OFF);
    Some((threshold < DAYLIGHT_OFF).then_some(threshold))
}

/// Writes a daylight threshold into an automation's configuration, `None`
/// meaning ignore daylight. Returns false when it has no daylight setting.
pub fn set_dark_threshold(configuration: &mut Value, threshold: Option<u32>) -> bool {
    match configuration.pointer_mut(DARK_THRESHOLD_POINTER) {
        Some(slot) => {
            *slot = Value::from(threshold.unwrap_or(DAYLIGHT_OFF));
            true
        }
        None => false,
    }
}

/// motion service ID → the daylight setting of the first automation on it.
fn daylight_by_service(automations: &[BehaviorInstanceResource]) -> HashMap<&str, Daylight> {
    let mut map = HashMap::new();
    for automation in automations {
        let Some(rid) = automation
            .configuration
            .pointer(MOTION_SERVICE_RID_POINTER)
            .and_then(Value::as_str)
        else {
            continue;
        };
        let Some(threshold) = dark_threshold(&automation.configuration) else {
            continue;
        };
        map.entry(rid).or_insert_with(|| Daylight {
            automation_id: automation.id.clone(),
            dark_threshold: threshold,
        });
    }
    map
}

fn sensitivity(data: &SensitivityData) -> Option<Sensitivity> {
    Some(Sensitivity {
        value: data.sensitivity?,
        max: data.sensitivity_max?,
    })
}

fn motion_state(data: &MotionData) -> (Option<bool>, Option<String>) {
    match &data.motion_report {
        Some(report) => (Some(report.motion), Some(report.changed.clone())),
        None => (data.motion, None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn parse<T: serde::de::DeserializeOwned>(value: Value) -> Vec<T> {
        serde_json::from_value(value).unwrap()
    }

    fn report(motion: bool) -> Value {
        json!({"motion_report": {"changed": "2026-10-04T09:00:00Z", "motion": motion}})
    }

    fn automation(id: &str, service: &str, threshold: Option<u32>) -> Value {
        let mut configuration = json!({
            "motion": {"motion_service": {"rid": service, "rtype": "motion"}},
            "source": {"rid": "device-x", "rtype": "device"},
        });
        if let Some(t) = threshold {
            configuration["light_level"] = json!({"daylight": {"daylight_sensitivity": {
                "light_level_service": {"rid": "ll", "rtype": "light_level"},
                "settings": {"dark_threshold": t, "offset": 7000},
            }}});
        }
        json!({"id": id, "configuration": configuration})
    }

    /// The kitchen setup: a sensor and a MotionAware area in one service
    /// group, next to a hallway sensor on its own.
    fn units() -> Vec<MotionUnit> {
        let motions = parse::<MotionResource>(json!([
            {"id": "m-kitchen", "owner": {"rid": "d-kitchen"}, "enabled": true,
             "motion": report(false), "sensitivity": {"sensitivity": 2, "sensitivity_max": 2}},
            {"id": "m-hall", "owner": {"rid": "d-hall"}, "enabled": false,
             "motion": {"motion_valid": false}},
        ]));
        let areas = parse::<ConvenienceAreaMotionResource>(json!([
            {"id": "a-kitchen", "owner": {"rid": "cfg-kitchen"}, "enabled": true,
             "motion": report(false), "sensitivity": {"sensitivity": 3, "sensitivity_max": 4}},
        ]));
        let area_configs = parse::<MotionAreaConfigurationResource>(json!([
            {"id": "cfg-kitchen", "name": "Keittiö"},
        ]));
        let grouped = parse::<GroupedMotionResource>(json!([
            {"id": "g-kitchen", "motion": report(true)},
            {"id": "g-room", "motion": report(false)},
        ]));
        let service_groups = parse::<ServiceGroupResource>(json!([
            {"id": "sg-kitchen", "metadata": {"name": "Keittiö"},
             "children": [
                 {"rid": "m-kitchen", "rtype": "motion"},
                 {"rid": "ll-kitchen", "rtype": "light_level"},
                 {"rid": "a-kitchen", "rtype": "convenience_area_motion"},
             ],
             "services": [
                 {"rid": "g-kitchen", "rtype": "grouped_motion"},
                 {"rid": "gl-kitchen", "rtype": "grouped_light_level"},
             ]},
        ]));
        let automations = parse::<BehaviorInstanceResource>(json!([
            automation("b-kitchen", "g-kitchen", Some(14477)),
            automation("b-hall", "m-hall", Some(DAYLIGHT_OFF)),
            automation("b-hall-2", "m-hall", Some(100)),
            {"id": "b-other", "configuration": {"when": {}}},
        ]));
        let device_names = HashMap::from([("d-kitchen", "Keittiön anturi"), ("d-hall", "Käytävä")]);

        build_motion_units(&MotionInputs {
            motions: &motions,
            areas: &areas,
            area_configs: &area_configs,
            grouped: &grouped,
            service_groups: &service_groups,
            automations: &automations,
            device_names: &device_names,
        })
    }

    #[test]
    fn groups_members_behind_their_grouped_motion() {
        let units = units();
        let kitchen = units.iter().find(|u| u.id == "sg-kitchen").unwrap();

        assert_eq!(kitchen.name, "Keittiö");
        assert_eq!(kitchen.motion_service_id, "g-kitchen");
        assert_eq!(
            kitchen.motion,
            Some(true),
            "the group's motion, not a member's"
        );
        let members: Vec<_> = kitchen
            .members
            .iter()
            .map(|m| (m.id.as_str(), m.kind, m.name.as_str()))
            .collect();
        assert_eq!(
            members,
            [
                ("m-kitchen", MotionMemberKind::Sensor, "Keittiön anturi"),
                ("a-kitchen", MotionMemberKind::Area, "Keittiö"),
            ]
        );
    }

    #[test]
    fn members_keep_their_own_sensitivity() {
        let units = units();
        let kitchen = units.iter().find(|u| u.id == "sg-kitchen").unwrap();
        let scales: Vec<_> = kitchen
            .members
            .iter()
            .map(|m| m.sensitivity.map(|s| (s.value, s.max)))
            .collect();

        assert_eq!(scales, [Some((2, 2)), Some((3, 4))]);
    }

    #[test]
    fn grouped_members_are_not_units_of_their_own() {
        let ids: Vec<_> = units().into_iter().map(|u| u.id).collect();

        assert_eq!(ids, ["sg-kitchen", "m-hall"], "sorted by name");
    }

    #[test]
    fn lone_sensor_is_a_unit_of_one() {
        let units = units();
        let hall = units.iter().find(|u| u.id == "m-hall").unwrap();

        assert_eq!(hall.name, "Käytävä");
        assert_eq!(hall.motion_service_id, "m-hall");
        assert_eq!(hall.members.len(), 1);
        assert!(!hall.members[0].enabled);
        assert!(hall.members[0].sensitivity.is_none());
    }

    #[test]
    fn daylight_comes_from_the_automation_on_the_unit() {
        let units = units();
        let kitchen = units.iter().find(|u| u.id == "sg-kitchen").unwrap();
        let hall = units.iter().find(|u| u.id == "m-hall").unwrap();

        let kitchen_daylight = kitchen.daylight.as_ref().unwrap();
        assert_eq!(kitchen_daylight.automation_id, "b-kitchen");
        assert_eq!(kitchen_daylight.dark_threshold, Some(14477));

        let hall_daylight = hall.daylight.as_ref().unwrap();
        assert_eq!(
            hall_daylight.automation_id, "b-hall",
            "first automation wins"
        );
        assert_eq!(hall_daylight.dark_threshold, None, "65534 ignores daylight");
    }

    #[test]
    fn set_dark_threshold_rewrites_only_the_threshold() {
        let mut configuration = automation("b", "m", Some(14477))["configuration"].clone();
        let expected = {
            let mut c = configuration.clone();
            c["light_level"]["daylight"]["daylight_sensitivity"]["settings"]["dark_threshold"] =
                json!(20000);
            c
        };

        assert!(set_dark_threshold(&mut configuration, Some(20000)));
        assert_eq!(configuration, expected);

        assert!(set_dark_threshold(&mut configuration, None));
        assert_eq!(dark_threshold(&configuration), Some(None));
    }

    #[test]
    fn set_dark_threshold_refuses_automation_without_daylight() {
        let mut configuration = automation("b", "m", None)["configuration"].clone();
        let before = configuration.clone();

        assert!(!set_dark_threshold(&mut configuration, Some(20000)));
        assert_eq!(configuration, before);
    }
}
