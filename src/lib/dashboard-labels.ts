/** Comparison sublabels per dashboard period ("vs ontem", …).
 *  Kept in its own client-safe module so both the server metrics component and
 *  the client view can import it without pulling server-only code into the
 *  browser bundle. */
export const SUBLABEL: Record<string, string> = {
  today: "vs ontem",
  yesterday: "vs anteontem",
  last7: "vs 7 dias anteriores",
  last30: "vs 30 dias anteriores",
  week: "vs semana passada",
  month: "vs mês passado",
  year: "vs período anterior",
  custom: "vs período anterior",
};
