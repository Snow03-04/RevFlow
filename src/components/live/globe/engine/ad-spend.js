import { pacingFraction } from "@/lib/ads/pacing";

/** Both privacy controls remove the numbers and accessible numeric attributes.
 * The quiet blue fill remains; hovering cannot bring the numbers back. */
export function paintAdSpend(root, { report, store, day, replaying, privateNumbers, formatMoney }) {
  const panel = root.querySelector("#ad-progress");
  panel.hidden = !!replaying;
  const total = report?.day === day ? (store === "all" ? report.full : report.stores[store]) : null;
  const fraction = total ? pacingFraction(total) : null;
  const track = root.querySelector("#ad-progress-track"), values = root.querySelector("#ad-progress-values");
  root.querySelector("#ad-progress-fill").style.width = `${(fraction ?? 0) * 100}%`;
  root.querySelector("#ad-progress-label").textContent = fraction == null ? "Ad spend · previsão por apurar" : "Ad spend";
  values.textContent = !privateNumbers && total?.status === "ready" ? `${formatMoney(total.spent)} / ${formatMoney(total.forecast)} previstos` : "";
  values.hidden = !!privateNumbers;
  for (const attribute of ["aria-valuenow", "aria-valuetext", "aria-valuemin", "aria-valuemax"]) track.removeAttribute(attribute);
  track.removeAttribute("title");
  if (!privateNumbers && fraction != null) {
    track.setAttribute("role", "progressbar");
    track.setAttribute("aria-valuemin", "0"); track.setAttribute("aria-valuemax", "100");
    track.setAttribute("aria-valuenow", String(Math.round(fraction * 100)));
    track.setAttribute("aria-valuetext", values.textContent);
  } else track.setAttribute("role", "img");
}
