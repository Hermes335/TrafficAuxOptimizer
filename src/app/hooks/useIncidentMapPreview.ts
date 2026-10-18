import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import maplibregl from "maplibre-gl";
import { fetchReportIncident, type ReportIncident } from "../services/incidentReporting";
import { popupCard } from "../services/mapPopup";

interface UseIncidentMapPreviewOptions {
  reportId: string | null;
  map: maplibregl.Map | null;
  hasFittedRef: MutableRefObject<boolean>;
}

interface PreviewState {
  key: string | null;
  report: ReportIncident | null;
  loading: boolean;
  error: string | null;
}

function reportCoordinates(report: ReportIncident): [number, number] | null {
  const { latitude, longitude } = report;
  if (typeof latitude !== "number" || !Number.isFinite(latitude) || Math.abs(latitude) > 90
    || typeof longitude !== "number" || !Number.isFinite(longitude) || Math.abs(longitude) > 180) return null;
  return [longitude, latitude];
}

function label(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, character => character.toUpperCase());
}

function previewMarkerElement(report: ReportIncident): HTMLButtonElement {
  const pending = report.status === "pending";
  const reference = report.reference || `#${report.id}`;
  const title = `${pending ? "Pending report" : `${label(report.status)} incident preview`} ${reference}`;
  const element = document.createElement("button");
  element.type = "button";
  element.setAttribute("aria-label", title);
  element.title = title;
  element.className = "rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700";
  Object.assign(element.style, { width: "36px", height: "44px", padding: "0", border: "0", background: "transparent", cursor: "pointer", zIndex: "5" });

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 36 44");
  svg.setAttribute("width", "36");
  svg.setAttribute("height", "44");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.style.filter = "drop-shadow(0 2px 2px rgb(15 23 42 / 0.25))";
  const pin = document.createElementNS(svg.namespaceURI, "path");
  pin.setAttribute("d", "M18 2C9.7 2 3 8.7 3 17c0 11 15 24 15 24s15-13 15-24C33 8.7 26.3 2 18 2Z");
  pin.setAttribute("fill", pending ? "#fffbeb" : "#eff6ff");
  pin.setAttribute("stroke", pending ? "#b45309" : "#1d4ed8");
  pin.setAttribute("stroke-width", "2.5");
  const circle = document.createElementNS(svg.namespaceURI, "circle");
  circle.setAttribute("cx", "18");
  circle.setAttribute("cy", "17");
  circle.setAttribute("r", pending ? "7" : "5");
  circle.setAttribute("fill", pending ? "none" : "#1d4ed8");
  circle.setAttribute("stroke", pending ? "#b45309" : "#1d4ed8");
  circle.setAttribute("stroke-width", "2");
  svg.append(pin, circle);
  if (pending) {
    const hands = document.createElementNS(svg.namespaceURI, "path");
    hands.setAttribute("d", "M18 12v5h4");
    hands.setAttribute("fill", "none");
    hands.setAttribute("stroke", "#b45309");
    hands.setAttribute("stroke-width", "2");
    hands.setAttribute("stroke-linecap", "round");
    hands.setAttribute("stroke-linejoin", "round");
    svg.append(hands);
  }
  element.append(svg);
  return element;
}

function previewPopup(report: ReportIncident): HTMLElement {
  const reference = report.reference || `#${report.id}`;
  const content = popupCard(`${label(report.incident_type)} · ${reference}`, [
    report.status === "pending" ? "Pending review — not an active incident." : `Status: ${label(report.status)}`,
    `Severity: ${label(report.severity)}`,
    report.description,
  ]);
  content.style.overflowWrap = "anywhere";
  content.style.maxHeight = "220px";
  content.style.overflowY = "auto";
  return content;
}

export function useIncidentMapPreview({ reportId, map, hasFittedRef }: UseIncidentMapPreviewOptions) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<PreviewState>({ key: null, report: null, loading: false, error: null });
  const focusRef = useRef<{ key: string | null; map: maplibregl.Map; focus: () => void } | null>(null);
  const numericId = reportId !== null && /^[1-9]\d*$/.test(reportId) ? Number(reportId) : null;
  const validId = numericId !== null && Number.isSafeInteger(numericId);
  const requestKey = reportId === null ? null : `${reportId}:${attempt}`;
  const current = state.key === requestKey;
  // Never expose a previous report while a changed URL waits for its effect.
  const report = validId && current ? state.report : null;
  const loading = reportId !== null && validId && (!current || state.loading);
  const error = reportId !== null && !validId ? "This report link is invalid. Choose a report from Incident review."
    : current ? state.error : null;

  useEffect(() => {
    if (!validId || numericId === null || requestKey === null) return;
    let active = true;
    setState({ key: requestKey, report: null, loading: true, error: null });
    fetchReportIncident(numericId).then(result => {
      if (!active) return;
      if (result.id !== numericId) throw new Error("This report could not be matched to the selected location. Try again.");
      if (result.status === "rejected" || result.status === "resolved") {
        throw new Error(`This report is ${result.status}. Its map preview is no longer available.`);
      }
      if (!["pending", "active", "investigating"].includes(result.status)) {
        throw new Error("This report's status does not support a map preview.");
      }
      if (!reportCoordinates(result)) throw new Error("This report has no valid map location. Return to Incident review for its details.");
      setState({ key: requestKey, report: result, loading: false, error: null });
    }).catch((fetchError: unknown) => {
      if (!active) return;
      setState({ key: requestKey, report: null, loading: false, error: fetchError instanceof Error ? fetchError.message : "The report location could not be loaded. Try again." });
    });
    return () => { active = false; };
  }, [numericId, requestKey, validId]);

  useEffect(() => {
    if (!map || !report) return;
    const coordinates = reportCoordinates(report);
    if (!coordinates) return;
    let removed = false;
    let marker: maplibregl.Marker | null = null;
    let popup: maplibregl.Popup | null = null;
    const unavailable = () => {
      setState(previous => previous.key === requestKey
        ? { ...previous, error: "The map could not show this report. Try again." } : previous);
    };
    const focus = () => {
      if (removed) return;
      try {
        // Camera movement and DOM markers work before raster tiles finish loading.
        map.flyTo({ center: coordinates, zoom: 17, duration: 800 });
        hasFittedRef.current = true;
      } catch {
        unavailable();
      }
    };
    const remove = () => {
      if (removed) return;
      removed = true;
      if (focusRef.current?.focus === focus) focusRef.current = null;
      marker?.remove();
      popup?.remove();
    };
    map.on("remove", remove);
    try {
      popup = new maplibregl.Popup({ offset: 38, maxWidth: "280px", focusAfterOpen: false }).setDOMContent(previewPopup(report));
      marker = new maplibregl.Marker({ element: previewMarkerElement(report), anchor: "bottom" });
      marker.setLngLat(coordinates).setPopup(popup).addTo(map);
      focusRef.current = { key: requestKey, map, focus };
      focus();
    } catch {
      remove();
      unavailable();
    }
    return () => {
      map.off("remove", remove);
      remove();
    };
  }, [map, report, requestKey, hasFittedRef]);

  const retry = useCallback(() => setAttempt(value => value + 1), []);
  const focusLocation = useCallback(() => {
    const currentFocus = focusRef.current;
    if (currentFocus?.key === requestKey && currentFocus.map === map) currentFocus.focus();
  }, [requestKey, map]);
  return { report, loading, error, retry, focusLocation };
}
