"""Validate request/CLI compatibility and the persisted dimension contract offline."""
import argparse
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import types
from unittest.mock import Mock, patch

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))
from converter.print_dimensions import (normalize_print_dimensions, add_print_dimension_arguments,
                              normalize_dimension_arguments)


def main():
    for value in ({'size': 17}, {'printWidthCm': 20, 'printHeightCm': 10, 'size': 99}):
        result = normalize_print_dimensions(dict(value))
        assert result == ({'printWidthCm': 17., 'printHeightCm': 17.} if 'printWidthCm' not in value
                          else {'printWidthCm': 20., 'printHeightCm': 10.})
    for value in ({'size': 17, 'printWidthCm': 20}, {'printHeightCm': 10}, {'size': 0},
                  {'size': .9}, {'printWidthCm': .9, 'printHeightCm': 10},
                  {'printWidthCm': 10, 'printHeightCm': .9}, {'size': -1}, {'size': float('nan')}, {'size': 100}, {'size': True}):
        try:
            normalize_print_dimensions(value)
        except ValueError:
            pass
        else:
            raise AssertionError(value)
    assert normalize_print_dimensions({'size': 1}) == {'printWidthCm': 1, 'printHeightCm': 1}
    for width, height in [(1, 99.9), (99.9, 1)]:
        assert normalize_print_dimensions({'printWidthCm': width, 'printHeightCm': height}) == {
            'printWidthCm': width, 'printHeightCm': height}
    parser = argparse.ArgumentParser()
    add_print_dimension_arguments(parser)
    args = normalize_dimension_arguments(parser.parse_args(['--print-width-cm', '20', '--print-height-cm', '10']))
    assert (args.print_width_cm, args.print_height_cm) == (20, 10)
    args = normalize_dimension_arguments(parser.parse_args(['--size', '17', '--diameter', '408']))
    assert (args.print_width_cm, args.print_height_cm) == (17, 17)
    sys.modules['boto3'] = types.ModuleType('boto3')
    spec = importlib.util.spec_from_file_location('process_request', str(REPO / 'converter/process-request.py'))
    assert spec is not None and spec.loader is not None
    process = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(process)
    request = normalize_print_dimensions({'size': 17, 'diameter': 408, 'requestId': 'test'})
    content = json.loads(process.attach_request_metadata_to_map_content(b'{}', request))
    assert content['metadata']['requestBody']['printWidthCm'] == 17
    assert 'size' not in content['metadata']['requestBody']
    # The email receiver handles both deployed legacy metadata and new rectangles.
    ses = Mock()
    boto = types.ModuleType('boto3')
    setattr(boto, 'client', Mock(return_value=ses))
    email_spec = importlib.util.spec_from_file_location('email_lambda', str(REPO / 'install/lambda-email-sending.py'))
    assert email_spec is not None and email_spec.loader is not None
    email = importlib.util.module_from_spec(email_spec)
    with patch.dict(sys.modules, {'boto3': boto}):
        email_spec.loader.exec_module(email)
    for dims, expected in [({'size': 17}, '17 × 17'),
                           ({'printWidthCm': 20, 'printHeightCm': 10}, '20 × 10')]:
        payload = {'meta': dict(dims, address='Fixture', permaUrl='https://example.com/map'), 'to': 'test@example.com'}
        assert email.lambda_handler({'body': json.dumps(payload)}, None)['statusCode'] == 200
        assert expected in ses.send_email.call_args.kwargs['Message']['Body']['Text']['Data']
    for dims in [{'size': .9}, {'printWidthCm': .9, 'printHeightCm': 10},
                 {'printWidthCm': 10, 'printHeightCm': .9}]:
        ses.reset_mock()
        try:
            email.lambda_handler({'body': json.dumps({'meta': dims})}, None)
        except ValueError:
            pass
        else:
            raise AssertionError('Sub-centimeter email dimensions must be rejected')
        ses.send_email.assert_not_called()
    payload = {'meta': {'printWidthCm': 20, 'printHeightCm': 10,
                        'address': 'Fixture', 'permaUrl': 'https://example.com/map'},
               'to': 'test@example.com', 'emailType': 'order'}
    try:
        email.lambda_handler({'body': json.dumps(payload)}, None)
    except ValueError:
        pass
    else:
        raise AssertionError('Rectangle must not reach partner ordering')
    subprocess.run(['node', 'test/regression/print-dimensions.js'], cwd=str(REPO), check=True)


if __name__ == '__main__':
    main()
