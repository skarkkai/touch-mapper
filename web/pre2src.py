#!/usr/bin/python3

from pathlib import Path
import re

FROM = 'pre-src'
TO = 'src'
SPECS = {
    'index': {
        'vars': {
        },
    },
    'area': {
        'vars': {
        },
    },
    'map': {
        'vars': {
        },
    },
    'help': {
        'vars': {
        },
    },
}
for name, spec in SPECS.items():
    contents = ''
    for filename in ('start', name, 'end'):
        contents += Path(FROM + '/' + filename + '.pre').read_text(encoding='utf-8')

    spec['vars']['pagename'] = name
    def var_replacer(matchobj):
        return spec['vars'][matchobj.group(1)]
    contents = re.sub(r"\[% *(\w+) *%\]", var_replacer, contents)

    with open(TO + '/' + name + '.ect', 'w', encoding='utf-8') as f:
        f.write(contents)
