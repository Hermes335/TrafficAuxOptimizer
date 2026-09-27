import { beforeEach, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useMapMarkers } from "../app/hooks/useMapMarkers";
import { poiCategories } from "../app/services/poiMarker";
import type { POI } from "../app/services/backend";
const stubs = vi.hoisted(() => ({markers: [] as any[]}));
vi.mock("maplibre-gl",()=>({
  default: {
    Marker: class {
      element: HTMLElement; popup: any; remove = vi.fn();
      constructor({element}: {element:HTMLElement}) {this.element=element;stubs.markers.push(this);}
      setLngLat() {return this;} addTo() {return this;} getElement(){return this.element;}
      setPopup(popup: any){this.popup=popup;return this;} getPopup(){return this.popup;} togglePopup(){this.popup.open=!this.popup.open;}
    },
    Popup: class {open=false; content?: HTMLElement; setDOMContent(content:HTMLElement){this.content=content;return this;} isOpen(){return this.open;}},
    LngLatBounds: class {extend(){return this;}},
  },
}));
beforeEach(()=>{stubs.markers.length=0;});
it("reuses markers by ID and preserves an open popup across unrelated renders and filtering",()=>{
  const map={isStyleLoaded:()=>true,once:vi.fn(),off:vi.fn(),fitBounds:vi.fn()};
  const node={id:"A",name:"Saved",status:"normal" as const,latitude:0,longitude:0,tsi:0.1};
  const base={mapRef:{current:map} as any,markersRef:{current:[]},hasFittedRef:{current:true},filteredBottlenecks:[node],
    incidents:[],pois:[],onMarkerClick:vi.fn()};
  const {rerender,unmount}=renderHook(props=>useMapMarkers(props),{initialProps:base});
  expect(stubs.markers).toHaveLength(1);
  const marker=stubs.markers[0], popup=marker.getPopup();marker.togglePopup();
  rerender({...base,filteredBottlenecks:[{...node}],onMarkerClick:vi.fn()});
  expect(stubs.markers).toHaveLength(1);
  expect(marker.getPopup()).toBe(popup); expect(popup.isOpen()).toBe(true);
  rerender({...base,filteredBottlenecks:[{...node,name:"Updated"}]});
  expect(stubs.markers).toHaveLength(1);
  expect(marker.getPopup().isOpen()).toBe(true);
  unmount();expect(marker.remove).toHaveBeenCalled();
});

it("shows operational markers while raster map tiles are unavailable",()=>{
  const map={isStyleLoaded:()=>false,once:vi.fn(),off:vi.fn(),fitBounds:vi.fn()};
  const node={id:"A",name:"Visible without tiles",status:"normal" as const,latitude:10.72,longitude:122.56,tsi:0.1};
  const {unmount}=renderHook(()=>useMapMarkers({mapRef:{current:map} as any,markersRef:{current:[]},
    hasFittedRef:{current:true},filteredBottlenecks:[node],incidents:[],pois:[],onMarkerClick:vi.fn()}));
  expect(stubs.markers).toHaveLength(1);
  expect(stubs.markers[0].getElement().getAttribute("aria-label")).toBe("Visible without tiles");
  unmount();
});

it("renders distinct accessible POI designs and updates a category without replacing its marker",()=>{
  const map={fitBounds:vi.fn()};
  const pois=poiCategories.map((category,index)=>({poi_id:`POI-${index}`,name:`Place ${index}`,category:category.value,
    latitude:10.72+index*0.001,longitude:122.56,priority_boost:1,is_active:true})) as POI[];
  const base={mapRef:{current:map} as any,markersRef:{current:[]},hasFittedRef:{current:true},filteredBottlenecks:[],
    incidents:[],pois,onMarkerClick:vi.fn()};
  const {rerender,unmount}=renderHook(props=>useMapMarkers(props),{initialProps:base});
  expect(stubs.markers).toHaveLength(5);
  expect(new Set(stubs.markers.map(marker=>marker.getElement().querySelector("svg path")?.getAttribute("d"))).size).toBe(5);
  poiCategories.forEach((category,index)=>{
    const element=stubs.markers[index].getElement();
    expect(element.dataset.poiCategory).toBe(category.value);
    expect(element.getAttribute("aria-label")).toBe(`${category.label}: Place ${index}`);
    expect(element.querySelector("svg path")?.getAttribute("fill")).toBe(category.color);
  });
  const marker=stubs.markers[0];
  marker.togglePopup();
  rerender({...base,pois:[{...pois[0],category:"school",name:"Renamed hospital"},...pois.slice(1)]});
  expect(stubs.markers).toHaveLength(5);
  expect(stubs.markers[0]).toBe(marker);
  expect(marker.getElement().dataset.poiCategory).toBe("school");
  expect(marker.getElement().getAttribute("aria-label")).toBe("School: Renamed hospital");
  expect(marker.getPopup().isOpen()).toBe(true);
  unmount();
});
