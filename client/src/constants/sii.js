// Valores validos de los 6 campos SII usados en el exportador SAGE R75.
// Fuente unica para tooltips (tabla proveedores, modal proveedor, panel fiscal
// de factura) y, si en el futuro anyadimos selects en la UI, tambien para
// renderizarlos desde aqui.
//
// Estructura: {nombre, marcador, valores: [{value, label, esDefault?, esRectificativa?}]}
// - nombre y marcador aparecen en la cabecera del tooltip.
// - esDefault marca el valor por defecto de la columna en proveedores (se anota
//   con "(por defecto)" en el tooltip).
// - esRectificativa (solo SII_TIPO_FACT) separa visualmente los R1-R5 del resto,
//   ya que el mapeo F1->R1 / F2->R5 lo hace el exportador cuando
//   es_rectificativa=true (ver PanelDetalleFiscal + sageExporter.crearIva).

export const SII_CLAVE = {
  nombre: 'Clave régimen SII',
  marcador: '*15',
  valores: [
    { value: 1,  label: 'Régimen general', esDefault: true },
    { value: 2,  label: 'Compensaciones REAGYP' },
    { value: 3,  label: 'Bienes usados / arte' },
    { value: 7,  label: 'Criterio de caja' },
    { value: 9,  label: 'Adquisiciones intracomunitarias' },
    { value: 11, label: 'Importación' },
  ],
};

export const SII_TIPO_FACT = {
  nombre: 'Tipo Factura SII',
  marcador: '*18',
  valores: [
    { value: 1,  label: 'F1 Ordinaria', esDefault: true },
    { value: 2,  label: 'F2 Simplificada' },
    { value: 5,  label: 'F5 Importación (DUA)' },
    { value: 6,  label: 'F6 Otros justificantes' },
    { value: 7,  label: 'R1 Art. 80.1, 80.2 y error fundado', esRectificativa: true },
    { value: 8,  label: 'R2 Art. 80.3 concurso',              esRectificativa: true },
    { value: 9,  label: 'R3 Art. 80.4 incobrables',           esRectificativa: true },
    { value: 10, label: 'R4 Resto',                            esRectificativa: true },
    { value: 11, label: 'R5 Rectificativa en simplificadas',  esRectificativa: true },
  ],
};

export const SII_TIPO_EXENCI = {
  nombre: 'Tipo Exención',
  marcador: '*16',
  valores: [
    { value: 1, label: 'No exenta', esDefault: true },
    { value: 2, label: 'E1 Exenta art. 20' },
    { value: 3, label: 'E2 Exenta art. 21' },
    { value: 4, label: 'E3 Exenta art. 22' },
    { value: 5, label: 'E4 Exenta art. 24' },
    { value: 6, label: 'E5 Exenta art. 25' },
    { value: 7, label: 'E6 Exenta otros' },
  ],
};

export const SII_TIPO_NO_SUJE = {
  nombre: 'Tipo No Sujeta',
  marcador: '*17',
  valores: [
    { value: 2, label: 'S1 Sujeta-No exenta', esDefault: true },
    { value: 3, label: 'S2 Sujeta-No exenta - Inversión sujeto pasivo' },
  ],
};

export const SII_TIPO_RECTIF = {
  nombre: 'Tipo Rectificativa',
  marcador: '*20',
  valores: [
    { value: 1, label: 'No rectificativa (forzado cuando es_rectificativa=false)' },
    { value: 2, label: 'Por diferencias', esDefault: true },
    { value: 3, label: 'Por sustitución' },
  ],
};

export const SII_ENTR_PREST = {
  nombre: 'Entrega / Prestación',
  marcador: '*21',
  valores: [
    { value: 2, label: 'Entrega de bienes' },
    { value: 3, label: 'Prestación de servicios', esDefault: true },
  ],
};

// Genera un tooltip multilinea para title="" nativo HTML. Los \n son
// respetados por los navegadores modernos en el atributo title.
// Para SII_TIPO_FACT intercala una linea divisoria entre los F* y los R*.
export function tooltipSii(lista) {
  const header = `${lista.nombre} (${lista.marcador}):`;
  const lineas = [header];
  let rectificativasAbiertas = false;
  for (const v of lista.valores) {
    if (v.esRectificativa && !rectificativasAbiertas) {
      lineas.push('— Rectificativas (se asignan automáticamente si marcas "Factura rectificativa") —');
      rectificativasAbiertas = true;
    }
    const sufijo = v.esDefault ? ' (por defecto)' : '';
    lineas.push(`${v.value} = ${v.label}${sufijo}`);
  }
  return lineas.join('\n');
}

// Devuelve el label asociado a un valor dentro de una lista SII, o null si
// el valor no pertenece al dominio conocido. Util para mostrar "Valor
// actual: F1 Ordinaria" debajo de un input, si se prefiere a tooltip.
export function etiquetaValor(lista, valor) {
  if (valor == null) return null;
  const entry = lista.valores.find(v => v.value === Number(valor));
  return entry ? entry.label : null;
}
