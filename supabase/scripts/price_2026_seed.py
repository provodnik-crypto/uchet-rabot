"""Загрузка прайса 2026 из data/price_2026_max.csv.

Печатает SQL, который можно выполнить в базе (через SQL Editor Supabase или API управления).
Файл используется как есть: очистка сделана заранее (см. docs/PLAN.md).
Повторный запуск безопасен: уже загруженные позиции и цены не меняются,
поэтому ручные правки руководителя не затираются.

Запуск: python3 supabase/scripts/price_2026_seed.py > /tmp/price_2026.sql
"""

import csv
import sys
from decimal import Decimal
from pathlib import Path

CSV_PATH = Path(__file__).resolve().parents[2] / 'data' / 'price_2026_max.csv'
PRICE_LIST_TITLE = 'Прайс 2026 (временный, максимальные цены)'
VALID_FROM = '2026-01-01'
UNITS = {'шт', 'м²', 'м', 'м³', 'т', 'кг', 'км', 'ч', 'чел.-ч'}
YES_NO = {'да': True, 'нет': False}


def q(value):
    """Строка как SQL-литерал."""
    if value is None:
        return 'null'
    return "'" + str(value).replace("'", "''") + "'"


def load_rows(path=CSV_PATH):
    with open(path, encoding='utf-8-sig', newline='') as f:
        rows = list(csv.DictReader(f, delimiter=';'))
    items = []
    for r in rows:
        unit = r['ед_изм'].strip()
        if unit not in UNITS:
            raise ValueError(f"строка id={r['id']}: неизвестная единица {unit!r}")
        price_kop = Decimal(r['цена_руб'].replace(',', '.')) * 100
        if price_kop != price_kop.to_integral_value() or price_kop <= 0:
            raise ValueError(f"строка id={r['id']}: цена {r['цена_руб']!r} не в целых копейках")
        items.append({
            'source_id': int(r['id']),
            'full_name': r['полное_наименование'].strip(),
            'short_name': r['короткое_название'].strip() or r['полное_наименование'].strip(),
            'category': r['категория'].strip() or 'Без категории',
            'subcategory': r['подкатегория'].strip() or None,
            'unit': unit,
            'price_kop': int(price_kop),
            'is_material': YES_NO[r['это_материал'].strip()],
            'is_active': YES_NO[r['активна'].strip()],
            'source_block': r['блок_источник'].strip() or None,
            'source_row': int(r['строка_в_исходном_файле']) if r['строка_в_исходном_файле'].strip() else None,
        })
    return items


def build_sql(items):
    stats = {
        'rows': len(items),
        'active': sum(i['is_active'] for i in items),
        'visible_to_masters': sum(i['is_active'] and not i['is_material'] for i in items),
    }
    out = ['begin;']
    out.append(
        'insert into public.price_lists (title, valid_from, file_name, stats) '
        f"select {q(PRICE_LIST_TITLE)}, date {q(VALID_FROM)}, 'price_2026_max.csv', "
        f"jsonb_build_object('rows', {stats['rows']}, 'active', {stats['active']}, "
        f"'visible_to_masters', {stats['visible_to_masters']}) "
        f'where not exists (select 1 from public.price_lists where title = {q(PRICE_LIST_TITLE)});'
    )
    values = ',\n'.join(
        '({source_id}, {full}, {short}, {cat}, {sub}, {unit}, {mat}, {act}, {block}, {row}, {price})'.format(
            source_id=i['source_id'], full=q(i['full_name']), short=q(i['short_name']), cat=q(i['category']),
            sub=q(i['subcategory']), unit=q(i['unit']), mat=str(i['is_material']).lower(),
            act=str(i['is_active']).lower(), block=q(i['source_block']),
            row=i['source_row'] if i['source_row'] is not None else 'null', price=i['price_kop'],
        )
        for i in items
    )
    out.append(f"""create temp table _price_csv (
  source_id int, full_name text, short_name text, category text, subcategory text, unit text,
  is_material boolean, is_active boolean, source_block text, source_row int, price_kop bigint
) on commit drop;
insert into _price_csv values
{values};""")
    out.append("""insert into public.price_items
  (source_id, full_name, short_name, category, subcategory, unit_id, is_material, is_active, origin, source_block, source_row)
select c.source_id, c.full_name, c.short_name, c.category, c.subcategory, u.id,
       c.is_material,
       -- материалы хранятся выключенными
       c.is_active and not c.is_material,
       'csv', c.source_block, c.source_row
from _price_csv c join public.units u on u.code = c.unit
on conflict (source_id) do nothing;""")
    out.append(f"""insert into public.price_item_prices (price_item_id, price_kop, valid_from, price_list_id)
select p.id, c.price_kop, date {q(VALID_FROM)}, (select id from public.price_lists where title = {q(PRICE_LIST_TITLE)})
from _price_csv c join public.price_items p on p.source_id = c.source_id
on conflict (price_item_id, valid_from) do nothing;""")
    out.append('commit;')
    return '\n'.join(out) + '\n', stats


if __name__ == '__main__':
    sql, stats = build_sql(load_rows())
    sys.stdout.write(sql)
    print(f"-- строк: {stats['rows']}, активных: {stats['active']}, видно мастеру: {stats['visible_to_masters']}", file=sys.stderr)
