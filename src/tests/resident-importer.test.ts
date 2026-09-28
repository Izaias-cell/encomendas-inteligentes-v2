import {
  detectColumnMapping,
  formatFullResidence,
  normalizePhoneNumber,
  processRawResidents,
  RawSpreadsheetData,
  DuplicateStrategy
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
