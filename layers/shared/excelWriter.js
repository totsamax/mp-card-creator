'use strict';

const ExcelJS = require('exceljs');

/**
 * buildXlsx(masterData, columnMap) → Buffer
 *
 * @param {object[]} masterData - array of 5 SizeRecord objects (XS–XL)
 * @param {object}   columnMap  - contents of ozon.column-map.json or wb.column-map.json
 * @returns {Promise<Buffer>}   - xlsx file as a Buffer
 */
async function buildXlsx(masterData, columnMap) {
  const workbook  = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Линейка молдов');

  // Header row
  const headers = columnMap.columns.map(col => col.header);
  const headerRow = worksheet.addRow(headers);
  styleHeaderRow(headerRow);
  worksheet.getRow(1).height = 30;

  // Column widths
  columnMap.columns.forEach((col, idx) => {
    worksheet.getColumn(idx + 1).width = 22;
  });

  // Data rows — one per size
  for (const record of masterData) {
    const row = columnMap.columns.map(col => {
      let value = record[col.field] ?? '';
      // Append size suffix to article field for unique SKU per size
      if (col.suffix === 'size') value = `${value}-${record.size}`;
      return value;
    });
    const dataRow = worksheet.addRow(row);
    styleDataRow(dataRow);
  }

  // Freeze header row
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];

  return workbook.xlsx.writeBuffer();
}

function styleHeaderRow(row) {
  row.eachCell(cell => {
    cell.font      = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border    = { bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } } };
  });
}

function styleDataRow(row) {
  row.eachCell(cell => {
    cell.alignment = { vertical: 'middle', wrapText: true };
    cell.border    = { bottom: { style: 'hair', color: { argb: 'FFE5E7EB' } } };
  });
}

module.exports = { buildXlsx };
