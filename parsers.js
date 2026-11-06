const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { PDFParse } = require('pdf-parse');

function excelDateToISO(serial) {
  if (!serial || isNaN(serial)) return serial || '';
  const utc_days = Math.floor(serial - 25569);
  const utc_value = utc_days * 86400;
  const date_info = new Date(utc_value * 1000);
  return date_info.toISOString().split('T')[0];
}

function parseDateBr(str) {
  if (!str) return '';
  const match = str.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!match) return str;
  let [, d, m, y] = match;
  if (y.length === 2) y = '20' + y;
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

// Parser for Excel file: Controle de Lotes Ativos (Nutron / Feed Manager format)
function parseExcelLotesAtivos(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  
  if (!rows || rows.length < 2) throw new Error('Planilha sem dados suficientes');
  
  const headers = rows[0].map(h => String(h || '').trim());
  const idxLinha = headers.indexOf('Linha');
  const idxLote = headers.indexOf('Lote');
  const idxCurral = headers.indexOf('Curral');
  const idxRaca = headers.indexOf('Raça');
  const idxProp = headers.indexOf('Proprietário');
  const idxCat = headers.indexOf('Categoria');
  const idxTipoEnt = headers.indexOf('Tipo de Entrada');
  const idxQtd = headers.indexOf('Qtde Anm');
  const idxMorte = headers.indexOf('Mortes');
  const idxDtEnt = headers.indexOf('Data Média de Entrada');
  const idxVlrCompra = headers.indexOf('Valor de Compra ($/cab)');
  const idxDiasConf = headers.indexOf('Dias Confin Aberto');
  const idxDiasTrato = headers.indexOf('Dias Trato');
  const idxPesoEnt = headers.indexOf('Peso Médio de Entrada');
  const idxConsMO = headers.indexOf('Consumo Médio MO');
  const idxConsMS = headers.indexOf('Consumo Médio MS');
  const idxDieta = headers.indexOf('Dieta_Desc');
  const idxDiasDieta = headers.indexOf('Dias Dieta Atual');
  const idxPesoAbate = headers.indexOf('Peso Abate Previsto');
  const idxPesoHoje = headers.indexOf('Peso Estimado Hoje');
  const idxGpd = headers.indexOf('Dieta GPD Aj');
  const idxDtAbate = headers.indexOf('Data Estimada Abate');

  const lotes = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r[idxCurral >= 0 ? idxCurral : 2]) continue;

    const curralRaw = String(r[idxCurral >= 0 ? idxCurral : 2]).trim();
    // Normalizar baia (ex: "Baia 01" -> "1", "Baia 14" -> "14", "Enfermaria" -> "ENF", "Rotacionado 01" -> "Rot 1")
    let baiaNorm = curralRaw.replace(/Baia\s*0?/i, '').trim();
    if (curralRaw.toLowerCase().includes('enfermaria')) baiaNorm = 'ENF';
    else if (curralRaw.toLowerCase().includes('rotacionado 01')) baiaNorm = 'Rot 1';
    else if (curralRaw.toLowerCase().includes('rotacionado 02')) baiaNorm = 'Rot 2';
    else if (curralRaw.toLowerCase().includes('rotacionado 03')) baiaNorm = 'Rot 3';
    else if (curralRaw.toLowerCase().includes('piquete 01')) baiaNorm = 'Piq 1';
    else if (curralRaw.toLowerCase().includes('piquete 02')) baiaNorm = 'Piq 2';
    else if (curralRaw.toLowerCase().includes('piquete 03')) baiaNorm = 'Piq 3';
    else if (curralRaw.toLowerCase().includes('piquete 04')) baiaNorm = 'Piq 4';

    const loteNome = String(r[idxLote >= 0 ? idxLote : 1] || '').trim();
    const raca = String(r[idxRaca >= 0 ? idxRaca : 3] || 'NE');
    const categoria = String(r[idxCat >= 0 ? idxCat : 5] || 'Macho');
    const qtd = Number(r[idxQtd >= 0 ? idxQtd : 7]) || 0;
    const pesoEnt = Number(r[idxPesoEnt >= 0 ? idxPesoEnt : 13]) || 0;
    const pesoHoje = Number(r[idxPesoHoje >= 0 ? idxPesoHoje : 27]) || 0;
    const pesoAbate = Number(r[idxPesoAbate >= 0 ? idxPesoAbate : 26]) || 0;
    const gpd = Number(r[idxGpd >= 0 ? idxGpd : 28]) || 1.4;
    const dieta = String(r[idxDieta >= 0 ? idxDieta : 24] || '');
    const diasConfin = Number(r[idxDiasConf >= 0 ? idxDiasConf : 11]) || 0;
    const dtEnt = excelDateToISO(r[idxDtEnt >= 0 ? idxDtEnt : 9]);
    const dtAbate = excelDateToISO(r[idxDtAbate >= 0 ? idxDtAbate : 29]);
    const mortes = Number(r[idxMorte >= 0 ? idxMorte : 8]) || 0;
    const consumoMO = Number(r[idxConsMO >= 0 ? idxConsMO : 14]) || 0;

    const linhaNome = idxLinha >= 0 && r[idxLinha] ? String(r[idxLinha]).trim() : '';
    const tipoEnt = idxTipoEnt >= 0 && r[idxTipoEnt] ? String(r[idxTipoEnt]).trim() : 'Compra';
    const diasTrato = idxDiasTrato >= 0 && r[idxDiasTrato] ? Number(r[idxDiasTrato]) || 0 : 0;
    const consumoMS = idxConsMS >= 0 && r[idxConsMS] ? Number(r[idxConsMS]) || 0 : 0;

    lotes.push({
      linha: linhaNome,
      lote: loteNome,
      baia: baiaNorm,
      curralOriginal: curralRaw,
      raca,
      categoria,
      tipoEntrada: tipoEnt,
      qtdAnimais: qtd,
      mortes,
      pesoEntrada: pesoEnt,
      pesoEstimadoHoje: pesoHoje,
      pesoAbatePrev: pesoAbate,
      gpd,
      dieta,
      diasConfin,
      diasTrato,
      consumoMO,
      consumoMS,
      dataEntrada: dtEnt,
      dataEstimadaEmbarque: dtAbate
    });
  }
  return lotes;
}

// Parser for PDF: Controle de Lotes Ativos
async function parsePdfLotesAtivos(buffer) {
  const uint8 = new Uint8Array(buffer);
  const parser = new PDFParse(uint8);
  await parser.load();
  const res = await parser.getText();
  const text = res.text;

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const lotes = [];
  
  // Exemplo de linha no PDF:
  // LOTE C 50/2026 Baia 01 Nelore Novilha Compra 157 0 17/07/26 0 95 94 344,8 19,98 11,03 2,67 15,80 7,91 1,66 16,81 8,42 1,78 22092026_Term 22 22 74 0 0 450,0 475,5 1,5 02/10/26
  for (const line of lines) {
    if (line.startsWith('Linha:') || line.startsWith('Controle') || line.startsWith('Posição') || line.startsWith('Lote Curral') || line.startsWith('Page') || line.startsWith('Resumo')) {
      continue;
    }

    // Procura padrão com Baia XX ou Enfermaria ou Piquete ou Rotacionado
    const match = line.match(/^(.+?)\s+(Baia\s*\d+|Enfermaria|Piquete\s*\d+|Rotacionado\s*\d+|INVENTÁRIO)\s+(Nelore|Indefinida[^\s]*|Nelore[^\s]*|Cruzado|Angus)\s+(Novilha|Boi Inteiro[^\s]*|Vaca[^\s]*)\s+(Compra|Anm Prop)?\s*(\d+)\s+(\d+)\s+(\d{2}\/\d{2}\/\d{2,4})\s+(\d+)\s+(\d+)\s+(\d+)\s+([\d,.]+)/i);
    
    if (match) {
      const lote = match[1].trim();
      const curralRaw = match[2].trim();
      const raca = match[3].trim();
      const categoria = match[4].trim();
      const tipoEnt = match[5] ? match[5].trim() : 'Compra';
      const qtd = parseInt(match[6], 10) || 0;
      const mortes = parseInt(match[7], 10) || 0;
      const dtEnt = parseDateBr(match[8]);
      const diasConf = parseInt(match[10], 10) || 0;
      const diasTrato = parseInt(match[11], 10) || 0;
      const pesoEnt = parseFloat(match[12].replace(',', '.')) || 0;

      // Pegar tokens após o pesoEntrada para extrair consumoMO, consumoMS e Dieta
      const afterMatch = line.substring(match[0].length).trim();
      const afterTokens = afterMatch.split(/\s+/);
      const consumoMO = afterTokens[0] ? parseFloat(afterTokens[0].replace(',', '.')) || 0 : 0;
      const consumoMS = afterTokens[1] ? parseFloat(afterTokens[1].replace(',', '.')) || 0 : 0;
      const consumoPV = afterTokens[2] ? parseFloat(afterTokens[2].replace(',', '.')) || 0 : 0;

      // Dieta é o token com _Term, _Adap ou _Semi
      const dietaToken = afterTokens.find(t => t.includes('_Term') || t.includes('_Adap') || t.includes('_Semi')) || '';

      // Pegar os últimos elementos da linha para dieta, peso previsto, peso estimado e data abate
      const tokens = line.split(/\s+/);
      const dtAbateRaw = tokens[tokens.length - 1];
      const dtAbate = parseDateBr(dtAbateRaw);
      const gpd = parseFloat((tokens[tokens.length - 2] || '1.4').replace(',', '.')) || 1.4;
      const pesoHoje = parseFloat((tokens[tokens.length - 3] || '0').replace(',', '.')) || 0;
      const pesoAbate = parseFloat((tokens[tokens.length - 4] || '0').replace(',', '.')) || 0;

      let baiaNorm = curralRaw.replace(/Baia\s*0?/i, '').trim();
      if (curralRaw.toLowerCase().includes('enfermaria')) baiaNorm = 'ENF';
      else if (curralRaw.toLowerCase().includes('rotacionado 01')) baiaNorm = 'Rot 1';
      else if (curralRaw.toLowerCase().includes('rotacionado 02')) baiaNorm = 'Rot 2';
      else if (curralRaw.toLowerCase().includes('rotacionado 03')) baiaNorm = 'Rot 3';
      else if (curralRaw.toLowerCase().includes('piquete 01')) baiaNorm = 'Piq 1';
      else if (curralRaw.toLowerCase().includes('piquete 02')) baiaNorm = 'Piq 2';
      else if (curralRaw.toLowerCase().includes('piquete 03')) baiaNorm = 'Piq 3';

      lotes.push({
        lote,
        baia: baiaNorm,
        curralOriginal: curralRaw,
        raca,
        categoria,
        tipoEntrada: tipoEnt,
        qtdAnimais: qtd,
        mortes,
        pesoEntrada: pesoEnt,
        pesoEstimadoHoje: pesoHoje,
        pesoAbatePrev: pesoAbate,
        gpd,
        dieta: dietaToken,
        diasConfin: diasConf,
        diasTrato: diasTrato,
        consumoMO,
        consumoMS,
        consumoPV,
        dataEntrada: dtEnt,
        dataEstimadaEmbarque: dtAbate
      });
    }
  }

  return lotes;
}

module.exports = {
  parseExcelLotesAtivos,
  parsePdfLotesAtivos
};
