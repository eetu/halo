# PV model reference values

`pvlib_reference.json` holds expected values for every step of the PV model,
generated from [pvlib](https://pvlib-python.readthedocs.io/) — the reference
implementation of the published models this module implements. The unit tests in
the parent module check every step against it.

Sections:

| Key | Reference |
|---|---|
| `solar_position` | `pvlib.location.Location.get_solarposition` — apparent zenith and azimuth |
| `perez_spline` | the quadratic splines behind the Perez-Driesse coefficients |
| `perez_driesse` | `pvlib.irradiance.perez_driesse` over a grid of sky conditions |
| `airmass` | `pvlib.atmosphere.get_relative_airmass`, Kasten-Young 1989 |
| `dni_extra` | `pvlib.irradiance.get_extra_radiation`, Spencer |
| `reflection` | Martin & Ruiz diffuse and ground-reflected loss factors |
| `module_temp` | King 2004 module temperature |
| `huld_output` | Huld 2010 DC output |
| `end_to_end` | a synthetic clear-sky day through the complete model |

Solar position is the one place where matching to the last digit is not
possible: pvlib and the `solar-positioning` crate are separate NREL SPA
implementations and agree to roughly 1e-5 degrees, so the `end_to_end`
comparison carries a relative tolerance rather than an exact one.

The site and system parameters the fixtures were generated for are in the `site`
key, and mirrored as constants in `test_fixtures.rs`.
