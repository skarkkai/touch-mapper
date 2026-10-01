"""Chosen and applied tactile heights shared by workers and Blender (Python 3.5)."""
import math
if __package__:
    from . import tactile_constants as tc
else:
    import tactile_constants as tc

DEFAULT_HEIGHTS = {'roadHeightMm': tc.ROAD_HEIGHT_CAR_MM,
                   'pathHeightMm': tc.ROAD_HEIGHT_PEDESTRIAN_MM,
                   'buildingHeightMm': tc.BUILDING_HEIGHT_MM,
                   'railwayHeightMm': tc.RAILWAY_HEIGHT_MM}
SECTIONS = {'roads': 'roadHeightMm', 'paths': 'pathHeightMm',
            'buildings': 'buildingHeightMm', 'railways': 'railwayHeightMm'}
ZERO_EPSILON_MM = 0.01


def normalize_print_heights(values):
    """Supply defaults and reject malformed numbers without imposing UI limits."""
    for key, default in DEFAULT_HEIGHTS.items():
        value = values.get(key, default)
        if isinstance(value, bool) or value is None or value == '':
            raise ValueError(key + ' must be a finite number')
        number = float(value)
        if not math.isfinite(number):
            raise ValueError(key + ' must be a finite number')
        values[key] = number
    return values


def applied_print_heights(values):
    """Resolve omissions and the railway offset in physical millimetres."""
    chosen = normalize_print_heights(dict(values))
    heights = {section: (0.0 if abs(chosen[key]) <= ZERO_EPSILON_MM else chosen[key])
               for section, key in SECTIONS.items()}
    if heights['roads'] != 0 and heights['railways'] != 0 and abs(heights['roads'] - heights['railways']) <= 1e-9:
        heights['railways'] -= 0.01
    return heights


def add_print_height_arguments(parser):
    """Expose independent chosen heights to both converter entry points."""
    for key, default in DEFAULT_HEIGHTS.items():
        parser.add_argument('--' + key.replace('HeightMm', '-height-mm'), type=float, default=default)


def height_values_from_arguments(args):
    """Translate argparse names to the request field names."""
    return normalize_print_heights({key: getattr(args, key.replace('HeightMm', '_height_mm'))
                                    for key in DEFAULT_HEIGHTS})


def print_height_cli_arguments(values):
    """Forward chosen heights without losing precision or changing their meaning."""
    result = []
    chosen = normalize_print_heights(dict(values))
    for key in DEFAULT_HEIGHTS:
        result.extend(['--' + key.replace('HeightMm', '-height-mm'), str(chosen[key])])
    return result
