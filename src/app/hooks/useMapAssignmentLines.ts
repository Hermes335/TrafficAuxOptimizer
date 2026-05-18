import { useEffect } from "react";
import maplibregl from "maplibre-gl";
import type { Bottleneck, DeploymentScheduleItem } from "../services/backend";
import { getCongestionSeverity, getSeverityColor } from "../types/severity";

interface UseMapAssignmentLinesOptions {
  mapRef: React.RefObject<maplibregl.Map | null>;
  selectedView: string;
  bottlenecks: Bottleneck[];
  deployments: DeploymentScheduleItem[];
}

export function useMapAssignmentLines({
  mapRef,
  selectedView,
  bottlenecks,
  deployments,
}: UseMapAssignmentLinesOptions) {
  useEffect(() => {
    if (!mapRef.current || selectedView !== "Assignments") return;

    const map = mapRef.current;

    const addLayers = () => {
      // Remove existing layers/sources if present
      if (map.getLayer("assignment-lines")) map.removeLayer("assignment-lines");
      if (map.getLayer("assignment-dots")) map.removeLayer("assignment-dots");
      if (map.getSource("assignments")) map.removeSource("assignments");

      if (deployments.length === 0) return;

      // Build bottleneck lookup
      const bnLookup = new Map<string, Bottleneck>();
      for (const bn of bottlenecks) {
        bnLookup.set(bn.id, bn);
      }

      // Group deployments by bottleneck
      const bnAssignments = new Map<string, DeploymentScheduleItem[]>();
      for (const dep of deployments) {
        const existing = bnAssignments.get(dep.bottleneck) || [];
        existing.push(dep);
        bnAssignments.set(dep.bottleneck, existing);
      }

      // Create GeoJSON features for assignment lines and dots
      const lineFeatures: GeoJSON.Feature[] = [];
      const dotFeatures: GeoJSON.Feature[] = [];

      // Draw lines between bottlenecks that share the same officer (patrol routes)
      const officerAssignments = new Map<string, string[]>();
      for (const dep of deployments) {
        const existing = officerAssignments.get(dep.officer) || [];
        if (!existing.includes(dep.bottleneck)) {
          existing.push(dep.bottleneck);
        }
        officerAssignments.set(dep.officer, existing);
      }

      for (const [officer, bnIds] of officerAssignments) {
        if (bnIds.length < 2) continue;
        const coords: [number, number][] = [];
        for (const bnId of bnIds) {
          const bn = bnLookup.get(bnId);
          if (bn) coords.push([bn.longitude, bn.latitude]);
        }
        if (coords.length >= 2) {
          lineFeatures.push({
            type: "Feature",
            geometry: { type: "LineString", coordinates: coords },
            properties: { officer },
          });
        }
      }

      // Create dots for assigned bottlenecks with officer count
      for (const [bnId, deps] of bnAssignments) {
        const bn = bnLookup.get(bnId);
        if (!bn) continue;
        dotFeatures.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: [bn.longitude, bn.latitude] },
          properties: {
            id: bn.id,
            name: bn.name,
            officer_count: deps.length,
            officers: deps.map((d) => d.officer_name).join(", "),
            severity: getCongestionSeverity(bn),
          },
        });
      }

      // Add assignment lines source
      map.addSource("assignments", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [...lineFeatures, ...dotFeatures],
        },
      });

      // Draw patrol route lines
      map.addLayer({
        id: "assignment-lines",
        type: "line",
        source: "assignments",
        filter: ["==", ["geometry-type"], "LineString"],
        paint: {
          "line-color": "#3b82f6",
          "line-width": 2.5,
          "line-dasharray": [3, 2],
          "line-opacity": 0.8,
        },
      });

      // Draw assignment dots (larger, with count)
      map.addLayer({
        id: "assignment-dots",
        type: "circle",
        source: "assignments",
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-radius": [
            "interpolate", ["linear"], ["get", "officer_count"],
            1, 10,
            3, 16,
            6, 22,
          ],
          "circle-color": [
            "match", ["get", "severity"],
            "critical", "#ef4444",
            "heavy", "#f97316",
            "moderate", "#eab308",
            "#22c55e",
          ],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 3,
          "circle-opacity": 0.9,
        },
      });

      // Add click popup for assignment dots
      const onDotClick = (e: maplibregl.MapMouseEvent) => {
        const features = map.queryRenderedFeatures(e.point, { layers: ["assignment-dots"] });
        if (!features.length) return;
        const props = features[0].properties;
        new maplibregl.Popup({ offset: 15 })
          .setLngLat(e.lngLat)
          .setHTML(
            `<div style="min-width:180px">
              <div style="font-weight:600;margin-bottom:4px">${props?.id || ""}</div>
              <div style="font-size:13px;margin-bottom:6px">${props?.name || ""}</div>
              <div style="font-size:12px;color:#3b82f6;font-weight:600">${props?.officer_count || 0} officer(s) assigned</div>
              <div style="font-size:11px;color:#6b7280;margin-top:4px">${props?.officers || "None"}</div>
            </div>`
          )
          .addTo(map);
      };

      map.on("click", "assignment-dots", onDotClick);

      // Change cursor on hover
      map.on("mouseenter", "assignment-dots", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "assignment-dots", () => {
        map.getCanvas().style.cursor = "";
      });
    };

    if (map.isStyleLoaded()) {
      addLayers();
    } else {
      map.on("load", addLayers);
    }

    return () => {
      if (map.getLayer("assignment-lines")) map.removeLayer("assignment-lines");
      if (map.getLayer("assignment-dots")) map.removeLayer("assignment-dots");
      if (map.getSource("assignments")) map.removeSource("assignments");
    };
  }, [mapRef, selectedView, bottlenecks, deployments]);
}
