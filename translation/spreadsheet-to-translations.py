#!/usr/bin/python2

from __future__ import print_function
import sys
import argparse
import json
import xlrd
from collections import OrderedDict
from distutils.command.config import LANG_EXT

def do_cmdline():
    parser = argparse.ArgumentParser(description='''Convert translation spreadsheet into locale JSON''')
    parser.add_argument('--locales_dir', metavar='DIR', required=True)
    parser.add_argument('spreadsheet', metavar='SPREADSHEET')
    args = parser.parse_args()
    return args

def read_excel(filepath):
    book = xlrd.open_workbook(filename=filepath)
    sheet = book.sheet_by_index(0)
    header = [sheet.cell(0, col_index).value for col_index in xrange(sheet.ncols)]
    if 3 < len(header) > 4 or header[0] != 'code' or header[1] != 'en':
        raise Exception("invalid header: " + header)
    lang = header[2]

    tr = {}
    for row_index in xrange(1, sheet.nrows):
        tr[sheet.cell(row_index, 0).value.strip()] = sheet.cell(row_index, 2).value.strip()

    return lang, tr

def main():
    args = do_cmdline()
    with open(args.locales_dir + '/en/tm.json') as f:
        tr_en = json.load(f, object_pairs_hook=OrderedDict)
    lang, tr_new = read_excel(args.spreadsheet)
    with open(args.locales_dir + '/' + lang + '/tm.json') as f:
        tr_old = json.load(f)
    out = OrderedDict()
    for code, value_en in tr_en.iteritems():
        val = tr_new.get(code, tr_old.get(code))
        if val:
            out[code] = val
    out_path = args.locales_dir + '/' + lang + '/tm.json'
    print("creating " + out_path)
    with open(out_path, 'w') as f:
        f.write(json.dumps(out, indent=2, ensure_ascii=False, separators=(',', ': ')).encode('utf8'))

if __name__ == "__main__":
    main()
