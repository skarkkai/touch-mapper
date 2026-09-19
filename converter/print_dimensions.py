"""Physical dimensions shared by request ingress and converter CLIs (Python 3.5)."""
import math


def normalize_print_dimensions(values):
    """Validate an explicit pair, or migrate a legacy square, in place."""
    has_width = 'printWidthCm' in values
    has_height = 'printHeightCm' in values
    if has_width != has_height:
        raise ValueError('Both printWidthCm and printHeightCm are required')
    width = values.get('printWidthCm') if has_width else values.get('size')
    height = values.get('printHeightCm') if has_height else values.get('size')
    dimensions = []
    for value in (width, height):
        if isinstance(value, bool) or value is None:
            raise ValueError('Print dimensions must be numbers in [1, 99.9] cm')
        number = float(value)
        if not math.isfinite(number) or not 1 <= number <= 99.9:
            raise ValueError('Print dimensions must be numbers in [1, 99.9] cm')
        dimensions.append(number)
    values['printWidthCm'], values['printHeightCm'] = dimensions
    values.pop('size', None)
    values.pop('diameter', None)
    return values


def add_print_dimension_arguments(parser):
    """Keep old square CLI invocations usable while exposing independent axes."""
    parser.add_argument('--print-width-cm', type=float)
    parser.add_argument('--print-height-cm', type=float)
    parser.add_argument('--size', type=float, help='legacy square print size in cm')
    parser.add_argument('--diameter', type=float, help='deprecated; ignored')


def normalize_dimension_arguments(args):
    """Normalize CLI dimensions before passing them to another pipeline stage."""
    values = {'size': args.size}
    if args.print_width_cm is not None:
        values['printWidthCm'] = args.print_width_cm
    if args.print_height_cm is not None:
        values['printHeightCm'] = args.print_height_cm
    normalize_print_dimensions(values)
    args.print_width_cm = values['printWidthCm']
    args.print_height_cm = values['printHeightCm']
    return args
