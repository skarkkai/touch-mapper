#!/usr/bin/python2

from __future__ import print_function
import sys
import argparse
import json
import pprint
import xlwt
import xlrd
from collections import OrderedDict

def do_cmdline():
    parser = argparse.ArgumentParser(description='''Convert one locale JSON to a spreadsheet file''')
    parser.add_argument('--language', metavar='LANG', required=True)
    parser.add_argument('locales_dir', metavar='LOCALES_DIR')
    args = parser.parse_args()
    return args

def read_old_excel(filepath, lang):
    tr = {}
    book = xlrd.open_workbook(filename=filepath)
    if not book:
        return tr
    sheet = book.sheet_by_index(0)
    if sheet.cell(0, 2).value != lang:
        raise Exception("existing file %s has wrong language %s != %s" % (lang, sheet.cell(0, 2), lang))
    return sheet

def write_excel(excel_path, translations, lang):
    style_bold = xlwt.easyxf('font: bold on')

    book = xlwt.Workbook(encoding="utf-8")
    sheet = book.add_sheet("Touch Mapper " + lang)
    sheet.col(0).width = 7000
    sheet.col(1).width = 15000
    sheet.col(2).width = 15000
    sheet.col(3).width = 15000
    sheet.write(0, 0, "code", style_bold)
    sheet.write(0, 1, "en", style_bold)
    sheet.write(0, 2, lang, style_bold)
    sheet.write(0, 3, lang + ' previous', style_bold)

    style_wrap = xlwt.XFStyle()
    style_wrap.alignment.wrap = 1

    style_bold = xlwt.XFStyle()
    style_bold.alignment.wrap = 1
    font = xlwt.Font()
    font.bold = True
    style_bold.font = font

    tr_en = translations['en']
    tr_en_old = translations['en.old']
    tr_x = translations[lang]
    tr_x_old = translations[lang + '.old']
    line = 1
    for code, value in tr_en.iteritems():
        sheet.write(line, 0, code)
        sheet.write(line, 1, value, style_wrap)
        if tr_en.get(code, '') == tr_en_old.get(code, ''):
            sheet.write(line, 2, tr_x.get(code, ''), style_wrap)
        else:
            if tr_x_old.get(code, '') == '':
                sheet.write(line, 2, 'NEW', style_bold)
            else:
                sheet.write(line, 2, 'ENGLISH TEXT CHANGED', style_bold)
                sheet.write(line, 3, tr_x_old.get(code, ''))
        line = line + 1
    book.save(excel_path)

def main():
    args = do_cmdline()
    translations = {}

    # Read new strings
    with open(args.locales_dir + '/en/tm.json') as f:
        translations['en'] = json.load(f, object_pairs_hook=OrderedDict)
    with open(args.locales_dir + '/' + args.language + '/tm.json') as f:
        translations[args.language] = json.load(f)
    excel_path = 'translations-' + args.language + '.xls'

    # Read old strings and translations
    old_excel = read_old_excel(excel_path, args.language)
    translations[args.language + '.old'] = {}
    translations['en.old'] = {}
    for row_index in xrange(1, old_excel.nrows):
        code = old_excel.cell(row_index, 0).value.strip()
        translations[args.language + '.old'][code] = old_excel.cell(row_index, 2).value.strip()
        translations['en.old'][code]               = old_excel.cell(row_index, 1).value.strip()

    write_excel(excel_path, translations, args.language)

if __name__ == "__main__":
    main()
