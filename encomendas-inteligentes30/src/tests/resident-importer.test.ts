import {
  detectColumnMapping,
  formatFullResidence,
  normalizePhoneNumber,
  processRawResidents,
  RawSpreadsheetData,
  DuplicateStrategy,
  fixUtf8Mojibake,
  isLikelyPhoneNumber
} from '../services/residentImporter';
import { Morador } from '../types';
import { formatResidentAddress } from '../lib/residentUtils';

interface TestResult {
  name: string;
  passed: boolean;
  message: string;
}

const testResults: TestResult[] = [];

function assert(condition: boolean, testName: string, failureMsg: string) {
  if (condition) {
    testResults.push({ name: testName, passed: true, message: `✅ PASS: ${testName}` });
    console.log(`✅ PASS: ${testName}`);
  } else {
    testResults.push({ name: testName, passed: false, message: `❌ FAIL: ${failureMsg}` });
    console.error(`❌ FAIL: ${testName} - ${failureMsg}`);
  }
}

export function runResidentImporterTests() {
  console.log('\n======================================================');
  console.log('🧪 TESTES AUTOMATIZADOS RC1: MORADORES & IMPORTADOR INTELIGENTE');
  console.log('======================================================\n');

  // TESTES DE UTF-8 / MOJIBAKE
  assert(fixUtf8Mojibake('JoÃ£o Silva') === 'João Silva', 'UTF-8: "JoÃ£o Silva" -> "João Silva"', `Obtido: ${fixUtf8Mojibake('JoÃ£o Silva')}`);
  assert(fixUtf8Mojibake('AndrÃ©') === 'André', 'UTF-8: "AndrÃ©" -> "André"', `Obtido: ${fixUtf8Mojibake('AndrÃ©')}`);
  assert(fixUtf8Mojibake('MÃ¡rcia') === 'Márcia', 'UTF-8: "MÃ¡rcia" -> "Márcia"', `Obtido: ${fixUtf8Mojibake('MÃ¡rcia')}`);
  assert(fixUtf8Mojibake('JosÃ©') === 'José', 'UTF-8: "JosÃ©" -> "José"', `Obtido: ${fixUtf8Mojibake('JosÃ©')}`);
  assert(fixUtf8Mojibake('ConceiÃ§Ã£o') === 'Conceição', 'UTF-8: "ConceiÃ§Ã£o" -> "Conceição"', `Obtido: ${fixUtf8Mojibake('ConceiÃ§Ã£o')}`);
  assert(fixUtf8Mojibake('João Silva') === 'João Silva', 'UTF-8: String já correta não é corrompida', `Obtido: ${fixUtf8Mojibake('João Silva')}`);

  // TESTES DE DETECÇÃO DE NÚMERO DE TELEFONE (isLikelyPhoneNumber)
  assert(isLikelyPhoneNumber('41994440000') === true, 'isLikelyPhoneNumber detecta "41994440000"', `Obtido: ${isLikelyPhoneNumber('41994440000')}`);
  assert(isLikelyPhoneNumber('41991110003') === true, 'isLikelyPhoneNumber detecta "41991110003"', `Obtido: ${isLikelyPhoneNumber('41991110003')}`);
  assert(isLikelyPhoneNumber('41991110001') === true, 'isLikelyPhoneNumber detecta "41991110001"', `Obtido: ${isLikelyPhoneNumber('41991110001')}`);
  assert(isLikelyPhoneNumber('(41) 99111-0003') === true, 'isLikelyPhoneNumber detecta "(41) 99111-0003"', `Obtido: ${isLikelyPhoneNumber('(41) 99111-0003')}`);
  assert(isLikelyPhoneNumber('+55 41 99444-0000') === true, 'isLikelyPhoneNumber detecta "+55 41 99444-0000"', `Obtido: ${isLikelyPhoneNumber('+55 41 99444-0000')}`);
  assert(isLikelyPhoneNumber('CASA 426') === false, 'isLikelyPhoneNumber rejeita "CASA 426" (residência legítima)', `Obtido: ${isLikelyPhoneNumber('CASA 426')}`);
  assert(isLikelyPhoneNumber('AP 101') === false, 'isLikelyPhoneNumber rejeita "AP 101" (residência legítima)', `Obtido: ${isLikelyPhoneNumber('AP 101')}`);
  assert(isLikelyPhoneNumber('BLOCO A/AP 101') === false, 'isLikelyPhoneNumber rejeita "BLOCO A/AP 101" (residência legítima)', `Obtido: ${isLikelyPhoneNumber('BLOCO A/AP 101')}`);
  assert(isLikelyPhoneNumber('BLOCO 11/CASA 426') === false, 'isLikelyPhoneNumber rejeita "BLOCO 11/CASA 426" (residência legítima)', `Obtido: ${isLikelyPhoneNumber('BLOCO 11/CASA 426')}`);
  assert(isLikelyPhoneNumber('TORRE 5/CASA 426') === false, 'isLikelyPhoneNumber rejeita "TORRE 5/CASA 426" (residência legítima)', `Obtido: ${isLikelyPhoneNumber('TORRE 5/CASA 426')}`);
  assert(isLikelyPhoneNumber('426') === false, 'isLikelyPhoneNumber rejeita "426" (número de casa legítimo)', `Obtido: ${isLikelyPhoneNumber('426')}`);
  assert(isLikelyPhoneNumber('101') === false, 'isLikelyPhoneNumber rejeita "101" (número de apto legítimo)', `Obtido: ${isLikelyPhoneNumber('101')}`);

  // TESTE E: Residência "BLOCO A/AP 101"
  const blocoAAp101 = formatFullResidence('BLOCO A/AP 101');
  assert(blocoAAp101 === 'BLOCO A/AP 101', 'TESTE E: Preservação de BLOCO A/AP 101', `Esperado "BLOCO A/AP 101", obtido "${blocoAAp101}"`);

  // TESTE F: Residência "CASA 426"
  const casa426 = formatFullResidence('CASA 426');
  assert(casa426 === 'CASA 426', 'TESTE F: Preservação de CASA 426', `Esperado "CASA 426", obtido "${casa426}"`);

  // TESTE G: Residência "BLOCO 11/CASA 426"
  const bloco11Casa426 = formatFullResidence('BLOCO 11/CASA 426');
  assert(bloco11Casa426 === 'BLOCO 11/CASA 426', 'TESTE G: Preservação de BLOCO 11/CASA 426', `Esperado "BLOCO 11/CASA 426", obtido "${bloco11Casa426}"`);

  // TESTE H: Residência "TORRE 5/CASA 426"
  const torre5Casa426 = formatFullResidence('TORRE 5/CASA 426');
  assert(torre5Casa426 === 'TORRE 5/CASA 426', 'TESTE H: Preservação de TORRE 5/CASA 426', `Esperado "TORRE 5/CASA 426", obtido "${torre5Casa426}"`);

  // Teste de formatação com formatResidentAddress
  const residentMockG: Morador = { id: '1', nome: 'Carlos', unidade: 'BLOCO 11/CASA 426', telefone: '11999998888', ativo: true, created_at: '' };
  assert(formatResidentAddress(residentMockG) === 'BLOCO 11/CASA 426', 'formatResidentAddress preserva "BLOCO 11/CASA 426"', `Obtido: ${formatResidentAddress(residentMockG)}`);

  const residentMockH: Morador = { id: '2', nome: 'Ana', unidade: 'TORRE 5/CASA 426', telefone: '11999997777', ativo: true, created_at: '' };
  assert(formatResidentAddress(residentMockH) === 'TORRE 5/CASA 426', 'formatResidentAddress preserva "TORRE 5/CASA 426"', `Obtido: ${formatResidentAddress(residentMockH)}`);

  // Normalização de Telefones / WhatsApp
  const phone1 = normalizePhoneNumber('11987654321');
  assert(phone1 === '(11) 98765-4321', 'Formatação de celular (11) 98765-4321', `Obtido: ${phone1}`);

  const phone2 = normalizePhoneNumber('5511998765432');
  assert(phone2 === '(11) 99876-5432', 'Remoção de DDI 55 e formatação celular', `Obtido: ${phone2}`);

  const phoneEmpty = normalizePhoneNumber('');
  assert(phoneEmpty === '', 'Telefone vazio retorna string vazia', `Obtido: ${phoneEmpty}`);

  // Detecção de colunas
  const headersSample = ['Nome Completo', 'Casa / Apartamento', 'WhatsApp', 'CPF', 'RG', 'E-mail', 'Placa'];
  const mapping = detectColumnMapping(headersSample);
  assert(mapping.nameColumn === 'Nome Completo', 'Detecção da coluna Nome', `Obtido: ${mapping.nameColumn}`);
  assert(mapping.unitColumn === 'Casa / Apartamento', 'Detecção da coluna Residência/Unidade', `Obtido: ${mapping.unitColumn}`);
  assert(mapping.phoneColumn === 'WhatsApp', 'Detecção da coluna WhatsApp', `Obtido: ${mapping.phoneColumn}`);

  // Processamento com cenários A, B, C, D
  const rawSpreadsheet: RawSpreadsheetData = {
    headers: headersSample,
    rows: [
      {
        // TESTE A: Morador com residência + WhatsApp
        'Nome Completo': 'João Silva (Teste A)',
        'Casa / Apartamento': 'CASA 426',
        'WhatsApp': '11987654321'
      },
      {
        // TESTE B: Morador com residência + sem WhatsApp
        'Nome Completo': 'Lucas Pendente (Teste B)',
        'Casa / Apartamento': 'BLOCO B AP 102',
        'WhatsApp': ''
      },
      {
        // TESTE C: Morador sem residência + com WhatsApp
        'Nome Completo': 'Inconsistente Com Zap (Teste C)',
        'Casa / Apartamento': '',
        'WhatsApp': '11999997777'
      },
      {
        // TESTE D: Morador sem residência + sem WhatsApp
        'Nome Completo': 'Inconsistente Sem Zap (Teste D)',
        'Casa / Apartamento': '',
        'WhatsApp': ''
      }
    ],
    totalRows: 4
  };

  const processed = processRawResidents(rawSpreadsheet, mapping, []);

  // Validação TESTE A
  const recA = processed.records.find(r => r.nome.includes('Teste A'))!;
  assert(recA.status === 'complete' && recA.isSelected === true, 'TESTE A: Morador com residência + WhatsApp é Válido e Selecionado', `Status: ${recA.status}, isSelected: ${recA.isSelected}`);

  // Validação TESTE B
  const recB = processed.records.find(r => r.nome.includes('Teste B'))!;
  assert(recB.status === 'pending' && recB.isSelected === true, 'TESTE B: Morador com residência + sem WhatsApp é Pendente e Selecionado', `Status: ${recB.status}, isSelected: ${recB.isSelected}`);

  // Validação TESTE C
  const recC = processed.records.find(r => r.nome.includes('Teste C'))!;
  assert(recC.status === 'inconsistent' && recC.isSelected === false && recC.statusReasons.includes('Inconsistente — Residência obrigatória'), 
    'TESTE C: Morador sem residência + WhatsApp é Inconsistente — Residência obrigatória e Bloqueado', 
    `Status: ${recC.status}, isSelected: ${recC.isSelected}, Reasons: ${recC.statusReasons.join(', ')}`
  );

  // Validação TESTE D
  const recD = processed.records.find(r => r.nome.includes('Teste D'))!;
  assert(recD.status === 'inconsistent' && recD.isSelected === false && recD.statusReasons.includes('Inconsistente — Residência obrigatória'), 
    'TESTE D: Morador sem residência + sem WhatsApp é Inconsistente — Residência obrigatória e Bloqueado', 
    `Status: ${recD.status}, isSelected: ${recD.isSelected}, Reasons: ${recD.statusReasons.join(', ')}`
  );

  assert(processed.complete === 1, '1 Registro completo', `Obtido: ${processed.complete}`);
  assert(processed.pending === 1, '1 Registro pendente', `Obtido: ${processed.pending}`);
  assert(processed.inconsistent === 2, '2 Registros inconsistentes', `Obtido: ${processed.inconsistent}`);
  assert(processed.selectedToImport === 2, 'Apenas os 2 válidos selecionados para importação', `Obtido: ${processed.selectedToImport}`);

  // TESTES ESPECÍFICOS DE PLANILHA 4:
  // Cenário 1: Planilha 4 com nomes corrompidos UTF-8 ("JoÃ£o Silva", "AndrÃ©", etc.), residência real ("Casa 426", "A/101") e telefone ("41991110003", "41994440000")
  const planilha4Headers = ['Morador', 'Unidade Residencial', 'Telefone de Contato'];
  const p4Mapping = detectColumnMapping(planilha4Headers);
  assert(p4Mapping.nameColumn === 'Morador', 'Planilha 4: Detecção correta de Morador', `Obtido: ${p4Mapping.nameColumn}`);
  assert(p4Mapping.unitColumn === 'Unidade Residencial', 'Planilha 4: Detecção correta de Unidade Residencial', `Obtido: ${p4Mapping.unitColumn}`);
  assert(p4Mapping.phoneColumn === 'Telefone de Contato', 'Planilha 4: Detecção correta de Telefone de Contato', `Obtido: ${p4Mapping.phoneColumn}`);

  const planilha4Data: RawSpreadsheetData = {
    headers: planilha4Headers,
    rows: [
      {
        'Morador': 'JoÃ£o Silva',
        'Unidade Residencial': 'Casa 426',
        'Telefone de Contato': '41991110003'
      },
      {
        'Morador': 'AndrÃ© Santos',
        'Unidade Residencial': 'BLOCO A/AP 101',
        'Telefone de Contato': '41994440000'
      },
      {
        'Morador': 'MÃ¡rcia ConceiÃ§Ã£o',
        'Unidade Residencial': '426',
        'Telefone de Contato': '41991110001'
      }
    ],
    totalRows: 3
  };

  const processedP4 = processRawResidents(planilha4Data, p4Mapping, []);
  assert(processedP4.records[0].nome === 'João Silva', 'Planilha 4: "JoÃ£o Silva" decodificado para "João Silva"', `Obtido: ${processedP4.records[0].nome}`);
  assert(processedP4.records[0].unidade === 'Casa 426', 'Planilha 4: Residência legítima "Casa 426" preservada', `Obtido: ${processedP4.records[0].unidade}`);
  assert(processedP4.records[0].telefone === '(41) 99111-0003', 'Planilha 4: Telefone formatado "(41) 99111-0003" permanece exclusivamente no campo telefone', `Obtido: ${processedP4.records[0].telefone}`);

  assert(processedP4.records[1].nome === 'André Santos', 'Planilha 4: "AndrÃ© Santos" decodificado para "André Santos"', `Obtido: ${processedP4.records[1].nome}`);
  assert(processedP4.records[1].unidade === 'BLOCO A/AP 101', 'Planilha 4: Residência "BLOCO A/AP 101" preservada', `Obtido: ${processedP4.records[1].unidade}`);
  assert(processedP4.records[1].telefone === '(41) 99444-0000', 'Planilha 4: Telefone "(41) 99444-0000" preservado', `Obtido: ${processedP4.records[1].telefone}`);

  assert(processedP4.records[2].nome === 'Márcia Conceição', 'Planilha 4: "MÃ¡rcia ConceiÃ§Ã£o" decodificado para "Márcia Conceição"', `Obtido: ${processedP4.records[2].nome}`);
  assert(processedP4.records[2].unidade === '426', 'Planilha 4: Residência "426" preservada', `Obtido: ${processedP4.records[2].unidade}`);
  assert(processedP4.records[2].telefone === '(41) 99111-0001', 'Planilha 4: Telefone "(41) 99111-0001" preservado', `Obtido: ${processedP4.records[2].telefone}`);

  // Cenário 2: Planilha 4 com coluna "Número" (ou "Numero", "Nº") e 4 moradores reais
  const planilha4NumeroHeaders = ['Nome', 'Número', 'Telefone'];
  const p4NumMapping = detectColumnMapping(planilha4NumeroHeaders);
  assert(p4NumMapping.nameColumn === 'Nome', 'Planilha 4 (Número): Detecção de Nome', `Obtido: ${p4NumMapping.nameColumn}`);
  assert(p4NumMapping.unitColumn === 'Número', 'Planilha 4 (Número): Detecção correta da coluna "Número" como Residência', `Obtido: ${p4NumMapping.unitColumn}`);
  assert(p4NumMapping.phoneColumn === 'Telefone', 'Planilha 4 (Número): Detecção correta de Telefone', `Obtido: ${p4NumMapping.phoneColumn}`);

  const planilha4NumeroData: RawSpreadsheetData = {
    headers: planilha4NumeroHeaders,
    rows: [
      { 'Nome': 'JoÃ£o Silva', 'Número': '426', 'Telefone': '41991110003' },
      { 'Nome': 'Maria Santos', 'Número': '427', 'Telefone': '41994440000' },
      { 'Nome': 'Carlos Oliveira', 'Número': '428', 'Telefone': '41998881111' },
      { 'Nome': 'Ana Paula', 'Número': '429', 'Telefone': '41992223333' }
    ],
    totalRows: 4
  };

  const processedP4Num = processRawResidents(planilha4NumeroData, p4NumMapping, []);
  assert(processedP4Num.complete === 4, 'Planilha 4 (Número): Todos os 4 moradores com residência e telefone são completos', `Obtido: ${processedP4Num.complete}`);
  assert(processedP4Num.inconsistent === 0, 'Planilha 4 (Número): 0 registros inconsistentes', `Obtido: ${processedP4Num.inconsistent}`);
  assert(processedP4Num.selectedToImport === 4, 'Planilha 4 (Número): Todos os 4 selecionados para importação', `Obtido: ${processedP4Num.selectedToImport}`);

  // Validação dos 4 moradores
  assert(processedP4Num.records[0].nome === 'João Silva' && processedP4Num.records[0].unidade === '426' && processedP4Num.records[0].telefone === '(41) 99111-0003',
    'Planilha 4: Morador 1 (João Silva -> 426 -> (41) 99111-0003)',
    `Nome: ${processedP4Num.records[0].nome}, Unidade: ${processedP4Num.records[0].unidade}, Tel: ${processedP4Num.records[0].telefone}`
  );
  assert(processedP4Num.records[1].nome === 'Maria Santos' && processedP4Num.records[1].unidade === '427' && processedP4Num.records[1].telefone === '(41) 99444-0000',
    'Planilha 4: Morador 2 (Maria Santos -> 427 -> (41) 99444-0000)',
    `Nome: ${processedP4Num.records[1].nome}, Unidade: ${processedP4Num.records[1].unidade}, Tel: ${processedP4Num.records[1].telefone}`
  );
  assert(processedP4Num.records[2].nome === 'Carlos Oliveira' && processedP4Num.records[2].unidade === '428' && processedP4Num.records[2].telefone === '(41) 99888-1111',
    'Planilha 4: Morador 3 (Carlos Oliveira -> 428 -> (41) 99888-1111)',
    `Nome: ${processedP4Num.records[2].nome}, Unidade: ${processedP4Num.records[2].unidade}, Tel: ${processedP4Num.records[2].telefone}`
  );
  assert(processedP4Num.records[3].nome === 'Ana Paula' && processedP4Num.records[3].unidade === '429' && processedP4Num.records[3].telefone === '(41) 99222-3333',
    'Planilha 4: Morador 4 (Ana Paula -> 429 -> (41) 99222-3333)',
    `Nome: ${processedP4Num.records[3].nome}, Unidade: ${processedP4Num.records[3].unidade}, Tel: ${processedP4Num.records[3].telefone}`
  );

  // Validação do formatResidentAddress para os 4
  assert(formatResidentAddress(processedP4Num.records[0]) === '426', 'formatResidentAddress Morador 1 é "426" (NÃO "Sem Residência")', `Obtido: ${formatResidentAddress(processedP4Num.records[0])}`);
  assert(formatResidentAddress(processedP4Num.records[1]) === '427', 'formatResidentAddress Morador 2 é "427" (NÃO "Sem Residência")', `Obtido: ${formatResidentAddress(processedP4Num.records[1])}`);
  assert(formatResidentAddress(processedP4Num.records[2]) === '428', 'formatResidentAddress Morador 3 é "428" (NÃO "Sem Residência")', `Obtido: ${formatResidentAddress(processedP4Num.records[2])}`);
  assert(formatResidentAddress(processedP4Num.records[3]) === '429', 'formatResidentAddress Morador 4 é "429" (NÃO "Sem Residência")', `Obtido: ${formatResidentAddress(processedP4Num.records[3])}`);

  // Cenário 3: Planilha com cabeçalho "Nº"
  const p4NroHeaders = ['Morador', 'Nº', 'WhatsApp'];
  const p4NroMapping = detectColumnMapping(p4NroHeaders);
  assert(p4NroMapping.unitColumn === 'Nº', 'Detecção de coluna "Nº" como Residência', `Obtido: ${p4NroMapping.unitColumn}`);

  // Cenário 4: Se a coluna de residência tiver sido mapeada para um telefone (ex: "41994440000"), a validação impede explicitamente o telefone de ocupar o campo residência
  const corruptedUnitSpreadsheet: RawSpreadsheetData = {
    headers: ['Nome', 'Residencia Errada', 'Telefone'],
    rows: [
      {
        'Nome': 'JosÃ© Pereira',
        'Residencia Errada': '41994440000', // Telefone inserido no campo de residência
        'Telefone': '41994440000'
      }
    ],
    totalRows: 1
  };
  const corruptedUnitMapping = {
    nameColumn: 'Nome',
    unitColumn: 'Residencia Errada',
    phoneColumn: 'Telefone'
  };
  const processedCorrupted = processRawResidents(corruptedUnitSpreadsheet, corruptedUnitMapping, []);
  const recCorrupted = processedCorrupted.records[0];
  assert(recCorrupted.nome === 'José Pereira', 'Nome corrigido para "José Pereira"', `Obtido: ${recCorrupted.nome}`);
  assert(recCorrupted.unidade === '', 'Telefone "41994440000" é IMPEDIDO de ocupar o campo residência (fica vazio)', `Unidade obtida: "${recCorrupted.unidade}"`);
  assert(recCorrupted.telefone === '(41) 99444-0000', 'Telefone permanece no campo de telefone: "(41) 99444-0000"', `Telefone obtido: "${recCorrupted.telefone}"`);
  assert(recCorrupted.status === 'inconsistent' && recCorrupted.isSelected === false, 'Registro com telefone na residência é marcado como inconsistente e desmarcado', `Status: ${recCorrupted.status}`);

  // =========================================================================
  // TESTES DE REGRESSÃO E ESTABILIZAÇÃO: EXECUÇÕES SUCESSIVAS E INDEPENDÊNCIA
  // =========================================================================
  console.log('\n--- TESTES DE REGRESSÃO: IMPORTAÇÕES SUCESSIVAS E ESTABILIDADE ---');

  // Planilha A (Estrutura padrão com Casa/Apto)
  const sheetAData: RawSpreadsheetData = {
    headers: ['Morador', 'Casa', 'WhatsApp'],
    rows: [
      { 'Morador': 'Ana Lima', 'Casa': '101', 'WhatsApp': '41991112222' },
      { 'Morador': 'Bruno Silva', 'Casa': '102', 'WhatsApp': '41993334444' }
    ],
    totalRows: 2
  };
  const mapA = detectColumnMapping(sheetAData.headers);
  const resA1 = processRawResidents(sheetAData, mapA, []);

  assert(resA1.total === 2 && resA1.complete === 2, 'Importação 1 (Planilha A): 2 registros completos', `Obtido: total ${resA1.total}, completos ${resA1.complete}`);

  // Planilha B (Estrutura com Número, Notação científica e Observações)
  const sheetBData: RawSpreadsheetData = {
    headers: ['Nome', 'Número', 'Telefone', 'Observação'],
    rows: [
      { 'Nome': 'Carlos Souza', 'Número': '426', 'Telefone': '4.199111e+10', 'Observação': 'Proprietário' },
      { 'Nome': '', 'Número': '427', 'Telefone': '', 'Observação': 'Casa vaga' },
      { 'Nome': 'Daniela Castro', 'Número': '', 'Telefone': '41995556666', 'Observação': 'Sem unidade' }
    ],
    totalRows: 3
  };
  const mapB = detectColumnMapping(sheetBData.headers);
  const resB = processRawResidents(sheetBData, mapB, []);

  assert(resB.total === 3, 'Importação 2 (Planilha B): Total de 3 linhas', `Obtido: ${resB.total}`);
  assert(resB.complete === 1, 'Importação 2 (Planilha B): 1 completo (Carlos Souza)', `Obtido: ${resB.complete}`);
  assert(resB.pending === 1, 'Importação 2 (Planilha B): 1 pendente (Casa vaga com residência 427)', `Obtido: ${resB.pending}`);
  assert(resB.inconsistent === 1, 'Importação 2 (Planilha B): 1 inconsistente (Sem residência)', `Obtido: ${resB.inconsistent}`);
  assert(resB.records[0].telefone === '(41) 99111-0000', 'Importação 2 (Planilha B): Notação científica "4.199111e+10" normalizada com sucesso', `Obtido: ${resB.records[0].telefone}`);

  // Re-execução da Planilha A imediatamente após a Planilha B:
  // Deve produzir EXATAMENTE o mesmo resultado inicial sem herdar qualquer dado ou resíduo da Planilha B
  const resA2 = processRawResidents(sheetAData, mapA, []);
  assert(resA2.total === 2 && resA2.complete === 2, 'Importação 3 (Planilha A re-executada): 2 registros completos e zero contaminação', `Obtido: total ${resA2.total}, completos ${resA2.complete}`);
  assert(resA2.records[0].nome === 'Ana Lima' && resA2.records[0].unidade === '101', 'Importação 3 (Planilha A re-executada): Dados idênticos preservados', `Nome: ${resA2.records[0].nome}`);

  // Execução com Moradores Existentes (Validação de Duplicidades sem contaminação entre execuções)
  const existingDbMock: Morador[] = [
    { id: 'm1', nome: 'Ana Lima', unidade: '101', telefone: '41991112222', ativo: true, created_at: '' }
  ];
  const resA3 = processRawResidents(sheetAData, mapA, existingDbMock);
  assert(resA3.duplicates === 1, 'Importação 4 (com banco existente): Identifica 1 duplicidade existente', `Obtido: ${resA3.duplicates}`);
  assert(resA3.records[0].duplicateStatus === 'exact_duplicate', 'Importação 4: Morador Ana Lima marcado como exact_duplicate', `Status: ${resA3.records[0].duplicateStatus}`);
  assert(resA3.records[1].duplicateStatus === 'new', 'Importação 4: Morador Bruno Silva marcado como new', `Status: ${resA3.records[1].duplicateStatus}`);

  // Próxima execução sem moradores existentes volta a marcar todos como 'new' de forma pura
  const resA4 = processRawResidents(sheetAData, mapA, []);
  assert(resA4.duplicates === 0, 'Importação 5 (sem banco): 0 duplicidades', `Obtido: ${resA4.duplicates}`);
  assert(resA4.records[0].duplicateStatus === 'new', 'Importação 5: Ana Lima é considerada "new" novamente de forma determinística', `Status: ${resA4.records[0].duplicateStatus}`);

  console.log('\n------------------------------------------------------');
  const allPassed = testResults.every(r => r.passed);
  if (allPassed) {
    console.log(`🎉 TODOS OS ${testResults.length} TESTES HOMOLOGADOS PASSARAM COM SUCESSO!`);
  } else {
    console.error(`⚠️ ALGUNS TESTES FALHARAM.`);
  }
  console.log('------------------------------------------------------\n');

  return { allPassed, results: testResults };
}

// Auto-run se executado diretamente via tsx
if (import.meta.url === `file://${process.argv[1]}`) {
  runResidentImporterTests();
}
