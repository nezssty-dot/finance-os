export const ARS = (n: number) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n || 0)

/**
 * Formatea plata en la moneda que corresponde. ARS sin decimales (los centavos de peso
 * no aportan), el resto con 2 (un dólar con 50 centavos SÍ importa).
 *
 * Existe porque ARS() está clavado en pesos: usarlo para mostrar el saldo de una cuenta
 * en dólares diría "$500" como si fueran pesos. Cualquier saldo que pueda no ser ARS
 * tiene que pasar por acá.
 */
export const money = (n: number, currency = 'ARS') =>
  currency === 'ARS'
    ? ARS(n)
    : new Intl.NumberFormat('es-AR', {
        style: 'currency',
        currency,
        maximumFractionDigits: 2,
      }).format(n || 0)

export const fmtDate = (iso: string) => {
  try { return new Date(iso).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' }) }
  catch { return iso }
}

export const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
export const MONTHS_SHORT = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

export const pct = (expense: number, income: number) =>
  income > 0 ? (expense / income) * 100 : expense > 0 ? 100 : 0

export const healthHex = (p: number, has: boolean) =>
  !has ? '#212127' : p > 100 ? '#d9615c' : p >= 80 ? '#d4a53a' : '#5bbf7a'
