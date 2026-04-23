import { Morador } from '../types';

export const getResidentAddressLines = (resident: Morador | any) => {
  const lines: string[] = [];
  
  // Line 1: unit_type + unit_number
  const unitType = resident.unit_type || '';
  const unitNumber = resident.unit_number || resident.unidade || '';
  lines.push(`${unitType} ${unitNumber}`.trim());
  
  // Line 2: block (if exists)
  if (resident.block || resident.bloco) {
    lines.push(resident.block || resident.bloco);
  }
  
  // Line 3: street (if exists)
  if (resident.street) {
    lines.push(resident.street);
  }
  
  return lines;
};

export const formatResidentAddress = (resident: Morador | any) => {
  return getResidentAddressLines(resident).join(' • ');
};

export const formatPackageUnit = (pkg: any) => {
  const parts: string[] = [];
  
  // 1. unit_type + unit_number (fallback to unit_number_raw)
  const unitType = pkg.unit_type || '';
  const unitNum = pkg.unit_number || pkg.unit_number_raw || pkg.unit || '';
  
  if (unitNum) {
    if (unitType && unitType.toLowerCase() !== 'unidade') {
      parts.push(`${unitType} ${unitNum}`);
    } else {
      parts.push(unitNum);
    }
  } else if (unitType && unitType.toLowerCase() !== 'unidade') {
    parts.push(unitType);
  }

  // 2. block
  if (pkg.block || pkg.bloco) {
    parts.push(pkg.block || pkg.bloco);
  }

  // 3. tower
  if (pkg.tower || pkg.lote) {
    parts.push(`${pkg.tower ? 'Torre' : 'Lote'} ${pkg.tower || pkg.lote}`);
  }

  // 4. complement
  if (pkg.complement) {
    parts.push(pkg.complement);
  }

  // Fallback if everything is empty
  if (parts.length === 0) return 'Unidade';

  return parts.join(' • ');
};
