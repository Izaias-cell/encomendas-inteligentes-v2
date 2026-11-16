import { 
  isTimeInShift, 
  getBrasiliaDateParts, 
  getShiftStartDate, 
  getShiftDayParity, 
  parseEscalaTipo, 
  isPorterEligibleForShift, 
  findEligiblePorterForShift, 
  isPlantaoExpired,
  getActivePlantao,
  setActivePlantao,
  clearActivePlantao,
  PlantaoAtivo
} from '../lib/plantaoUtils';
import { Profile } from '../types';

if (typeof (globalThis as any).localStorage === 'undefined') {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, val: string) => store.set(key, String(val)),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear()
  };
}

let passed = 0;
let total = 0;

function assert(condition: boolean, msg: string) {
  total++;
  if (condition) {
    passed++;
    console.log(`✅ [PASS] ${msg}`);
  } else {
    console.error(`❌ [FAIL] ${msg}`);
    process.exitCode = 1;
  }
}

console.log('\n======================================================');
console.log('🕒 TESTES AUTOMATIZADOS: IDENTIFICAÇÃO DE PORTÃO E ESCALAS');
console.log('======================================================\n');

// 1. Fuso Horário de Brasília
// 2026-11-09T02:00:00Z -> em UTC é 02:00 do dia 09/11
// Em Brasília (UTC-3), é 23:00 do dia 08/11 (dia par)!
const utcDate = new Date('2026-11-09T02:00:00Z');
const brParts = getBrasiliaDateParts(utcDate);
assert(brParts.year === 2026 && brParts.month === 11 && brParts.day === 8 && brParts.hours === 23, 
  '1. Fuso Horário de Brasília converte corretamente 02:00 UTC para 23:00 BRT do dia anterior (08/11)');

// 2. Paridade do dia da escala em Brasília
// Dia 8 é par
assert(getShiftDayParity(brParts) === 'par', '2. Paridade do dia 08/11 em Brasília é corretamente identificada como "par"');
// Dia 9 é ímpar
const oddDate = new Date('2026-11-09T15:00:00Z'); // 12:00 BRT dia 9
assert(getShiftDayParity(getBrasiliaDateParts(oddDate)) === 'impar', '3. Paridade do dia 09/11 em Brasília é corretamente identificada como "impar"');

// 3. Janela de Turno Diurno (07:00 às 19:00)
const dateAt10BRT = new Date('2026-11-09T13:00:00Z'); // 10:00 BRT
assert(isTimeInShift(dateAt10BRT, '07:00', '19:00') === true, '4. Horário 10:00 BRT está dentro de 07:00 às 19:00');
assert(isTimeInShift(dateAt10BRT, '19:00', '07:00') === false, '5. Horário 10:00 BRT está fora de 19:00 às 07:00');

// 4. Janela de Turno Noturno atravessando a meia-noite (19:00 às 07:00)
const dateAt22BRT = new Date('2026-11-09T01:00:00Z'); // 22:00 BRT (dia 8)
assert(isTimeInShift(dateAt22BRT, '19:00', '07:00') === true, '6. Horário 22:00 BRT está dentro de 19:00 às 07:00');

const dateAt03BRT = new Date('2026-11-09T06:00:00Z'); // 03:00 BRT (madrugada do dia 9)
assert(isTimeInShift(dateAt03BRT, '19:00', '07:00') === true, '7. Horário 03:00 BRT da madrugada está dentro de 19:00 às 07:00');

// 5. Data de Início e Paridade do Plantão Noturno atravessando a meia-noite
// Na madrugada de 09/11 (dia ímpar) às 03:00 BRT, o plantão 19:00 - 07:00 iniciou às 19:00 de 08/11 (dia par)!
const shiftStartDuringDawn = getShiftStartDate(dateAt03BRT, '19:00', '07:00');
assert(shiftStartDuringDawn.day === 8 && shiftStartDuringDawn.month === 11, 
  '8. Plantão às 03:00 BRT do dia 9 reconhece que iniciou no dia anterior (dia 8)');
assert(getShiftDayParity(shiftStartDuringDawn) === 'par', 
  '9. Paridade atribuída à madrugada do dia 9 pertence ao início do turno no dia 8 ("par")');

// 6. Elegibilidade de Porteiros por Escala Par/Ímpar
const mockPorteiros: Profile[] = [
  {
    id: 'p-1',
    full_name: 'Porteiro Diurno Par',
    phone: '11999990001',
    condominium_id: 'condo-A',
    role: 'porteiro',
    active: true,
    horario_inicio: '07:00',
    horario_fim: '19:00',
    escala_tipo: 'par',
    created_at: new Date().toISOString()
  },
  {
    id: 'p-2',
    full_name: 'Porteiro Diurno Ímpar',
    phone: '11999990002',
    condominium_id: 'condo-A',
    role: 'porteiro',
    active: true,
    horario_inicio: '07:00',
    horario_fim: '19:00',
    escala_tipo: 'impar',
    created_at: new Date().toISOString()
  },
  {
    id: 'p-3',
    full_name: 'Porteiro Noturno Par',
    phone: '11999990003',
    condominium_id: 'condo-A',
    role: 'porteiro',
    active: true,
    horario_inicio: '19:00',
    horario_fim: '07:00',
    escala_tipo: 'par',
    created_at: new Date().toISOString()
  },
  {
    id: 'p-4',
    full_name: 'Porteiro Noturno Ímpar',
    phone: '11999990004',
    condominium_id: 'condo-A',
    role: 'porteiro',
    active: true,
    horario_inicio: '19:00',
    horario_fim: '07:00',
    escala_tipo: 'impar',
    created_at: new Date().toISOString()
  }
];

// Teste Diurno Dia 8 (Par) às 10:00 BRT
const dateDay8Daytime = new Date('2026-11-08T13:00:00Z'); // 10:00 BRT 08/11
const resDay8Day = findEligiblePorterForShift(mockPorteiros, dateDay8Daytime, 'condo-A');
assert(resDay8Day.count === 1 && resDay8Day.eligiblePorter?.id === 'p-1', 
  '10. Localiza perfeitamente o "Porteiro Diurno Par" no dia 08/11 às 10:00 BRT');

// Teste Diurno Dia 9 (Ímpar) às 10:00 BRT
const dateDay9Daytime = new Date('2026-11-09T13:00:00Z'); // 10:00 BRT 09/11
const resDay9Day = findEligiblePorterForShift(mockPorteiros, dateDay9Daytime, 'condo-A');
assert(resDay9Day.count === 1 && resDay9Day.eligiblePorter?.id === 'p-2', 
  '11. Localiza perfeitamente o "Porteiro Diurno Ímpar" no dia 09/11 às 10:00 BRT');

// Teste Noturno Dia 8 (Par) às 21:00 BRT
const dateDay8Night = new Date('2026-11-09T00:00:00Z'); // 21:00 BRT 08/11
const resDay8Night = findEligiblePorterForShift(mockPorteiros, dateDay8Night, 'condo-A');
assert(resDay8Night.count === 1 && resDay8Night.eligiblePorter?.id === 'p-3', 
  '12. Localiza perfeitamente o "Porteiro Noturno Par" no dia 08/11 às 21:00 BRT');

// Teste Noturno atravessando a meia-noite (madrugada do dia 9 às 02:00 BRT)
// O turno começou às 19:00 do dia 8 (Par), então o porteiro DEVE SER o Noturno Par!
const dateDay9Dawn = new Date('2026-11-09T05:00:00Z'); // 02:00 BRT 09/11
const resDay9Dawn = findEligiblePorterForShift(mockPorteiros, dateDay9Dawn, 'condo-A');
assert(resDay9Dawn.count === 1 && resDay9Dawn.eligiblePorter?.id === 'p-3', 
  '13. Madrugada do dia 09/11 (02:00 BRT) mantém o "Porteiro Noturno Par" que iniciou na noite do dia 8');

const condoBPorteiros: Profile[] = [
  {
    ...mockPorteiros[0],
    id: 'p-condo-B',
    condominium_id: 'condo-B',
    full_name: 'Porteiro de Outro Condomínio'
  },
  {
    ...mockPorteiros[0],
    id: 'p-no-condo',
    condominium_id: '' as any,
    full_name: 'Porteiro Sem Condomínio'
  }
];
const resCondoMismatch = findEligiblePorterForShift(condoBPorteiros, dateDay8Daytime, 'condo-A');
assert(resCondoMismatch.count === 0 && resCondoMismatch.eligiblePorter === null, 
  '14. Porteiros de outro condomínio são rigorosamente excluídos da seleção');

const portersNullCondo: Profile[] = [
  {
    ...mockPorteiros[0],
    id: 'p-null-condo',
    condominium_id: undefined as any,
    full_name: 'Porteiro com Condominium ID Indefinido'
  }
];
const resNullCondo = findEligiblePorterForShift(portersNullCondo, dateDay8Daytime, 'condo-A');
assert(resNullCondo.count === 0 && resNullCondo.eligiblePorter === null,
  '14b. Porteiros com condominium_id nulo/ausente são rigorosamente excluídos quando targetCondominiumId é fornecido');

// 8. Respeito aos Dias da Semana (ex: Segunda a Sexta)
// 09/11/2026 é uma Segunda-feira (dayOfWeek = 1)
// 08/11/2026 é um Domingo (dayOfWeek = 0)
const weekdayPorter: Profile = {
  id: 'p-weekday',
  full_name: 'Porteiro Segunda a Sexta',
  phone: '11999990005',
  condominium_id: 'condo-C',
  role: 'porteiro',
  active: true,
  horario_inicio: '08:00',
  horario_fim: '17:00',
  escala_tipo: 'segunda a sexta' as any,
  created_at: new Date().toISOString()
};

// Domingo às 10:00 BRT -> não elegível
const sundayAt10BRT = new Date('2026-11-08T13:00:00Z');
assert(isPorterEligibleForShift(weekdayPorter, sundayAt10BRT) === false, 
  '15. Porteiro com escala "segunda a sexta" não é elegível no Domingo');

// Segunda às 10:00 BRT -> elegível
const mondayAt10BRT = new Date('2026-11-09T13:00:00Z');
assert(isPorterEligibleForShift(weekdayPorter, mondayAt10BRT) === true, 
  '16. Porteiro com escala "segunda a sexta" é elegível na Segunda-feira');

// 9. Expiração de Plantão
const activeShift: PlantaoAtivo = {
  id: 'p-1',
  condominium_id: 'condo-A',
  porteiro_id: 'p-1',
  porteiro_nome: 'Porteiro Diurno Par',
  horario_inicio: '07:00',
  horario_fim: '19:00',
  started_at: '2026-11-08T10:00:00Z'
};
// Às 18:30 BRT ainda não expirou
const date1830BRT = new Date('2026-11-08T21:30:00Z'); // 18:30 BRT
assert(isPlantaoExpired(activeShift, date1830BRT) === false, 
  '17. Plantão das 07:00 às 19:00 NÃO está expirado às 18:30 BRT');

// Às 19:05 BRT expirou
const date1905BRT = new Date('2026-11-08T22:05:00Z'); // 19:05 BRT
assert(isPlantaoExpired(activeShift, date1905BRT) === true, 
  '18. Plantão das 07:00 às 19:00 está EXPIRADO às 19:05 BRT');

// 10. Testes Unitários de Isolamento de Condomínio com getActivePlantao()
// Cenário 1: Turno com condomínio correto (currentCondoId === parsed.condominium_id)
clearActivePlantao();
const validShiftCondoA: PlantaoAtivo = {
  id: 'shift-1',
  condominium_id: 'condo-A',
  porteiro_id: 'porteiro-1',
  porteiro_nome: 'Porteiro Carlos',
  horario_inicio: '00:00',
  horario_fim: '23:59',
  started_at: new Date().toISOString()
};
setActivePlantao(validShiftCondoA);
const resShiftCondoA = getActivePlantao('condo-A');
assert(resShiftCondoA !== null && resShiftCondoA.condominium_id === 'condo-A' && resShiftCondoA.porteiro_nome === 'Porteiro Carlos',
  '19. getActivePlantao(): Retorna com sucesso quando o condomínio corresponde exatamente (condo-A == condo-A)');

// Cenário 2: Turno de outro condomínio (condo-B vs condo-A)
const validShiftCondoB: PlantaoAtivo = {
  id: 'shift-2',
  condominium_id: 'condo-B',
  porteiro_id: 'porteiro-2',
  porteiro_nome: 'Porteiro de Outro Condomínio',
  horario_inicio: '00:00',
  horario_fim: '23:59',
  started_at: new Date().toISOString()
};
setActivePlantao(validShiftCondoB);
const resShiftMismatch = getActivePlantao('condo-A');
assert(resShiftMismatch === null, 
  '20. getActivePlantao(): Rejeita e limpa plantão gravado para outro condomínio (condo-B vs condo-A)');

// Cenário 3: Turno sem condo ID ou divergente
localStorage.setItem('encomendas_plantao_ativo', JSON.stringify({
  id: 'shift-3',
  condominium_id: '',
  porteiro_id: 'porteiro-3',
  porteiro_nome: 'Porteiro Sem Condomínio',
  horario_inicio: '00:00',
  horario_fim: '23:59',
  started_at: new Date().toISOString()
}));
const resShiftNoCondo = getActivePlantao('condo-A');
assert(resShiftNoCondo === null, 
  '21. getActivePlantao(): Rejeita e descarta plantão sem condominium_id quando target é condo-A');

// Cenário 4: Ausência de turno válido (storage vazio ou conteúdo corrompido)
clearActivePlantao();
const resShiftEmpty = getActivePlantao('condo-A');
assert(resShiftEmpty === null, 
  '22. getActivePlantao(): Retorna null em caso de storage vazio');

localStorage.setItem('encomendas_plantao_ativo', 'json_invalido_{{{');
const resShiftCorrupt = getActivePlantao('condo-A');
assert(resShiftCorrupt === null, 
  '23. getActivePlantao(): Trata erro e retorna null em caso de JSON corrompido no storage');

console.log('\n------------------------------------------------------');
console.log(`TOTAL APROVADOS: ${passed}/${total}`);
console.log('======================================================\n');

if (passed !== total) {
  process.exit(1);
}
