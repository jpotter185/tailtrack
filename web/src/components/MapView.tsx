import { useEffect, useRef, type MutableRefObject } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import type { Flight } from "../lib/types";
import { flightKey } from "../lib/flightKey";

interface MapViewProps {
  center: { lat: number; lon: number };
  flights: Flight[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
}

function planeIcon(headingDegrees: number | undefined, selected: boolean): L.DivIcon {
  return L.divIcon({
    className: `plane-icon${selected ? " selected" : ""}`,
    html: `<div style="transform: rotate(${headingDegrees ?? 0}deg)">&#9992;</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

const searchCenterIcon = L.divIcon({
  className: "search-center-icon",
  html: "&#128205;",
  iconSize: [24, 24],
  iconAnchor: [12, 24],
});

function RecenterMap({ center }: { center: { lat: number; lon: number } }) {
  const map = useMap();
  useEffect(() => {
    map.setView([center.lat, center.lon]);
  }, [center, map]);
  return null;
}

function FocusSelected({
  selectedKey,
  markerRefs,
}: {
  selectedKey: string | null;
  markerRefs: MutableRefObject<Map<string, L.Marker>>;
}) {
  const map = useMap();
  useEffect(() => {
    if (!selectedKey) return;
    const marker = markerRefs.current.get(selectedKey);
    if (!marker) return;
    map.panTo(marker.getLatLng());
    marker.openPopup();
  }, [selectedKey, map, markerRefs]);
  return null;
}

export default function MapView({ center, flights, selectedKey, onSelect }: MapViewProps) {
  const markerRefs = useRef<Map<string, L.Marker>>(new Map());

  return (
    <MapContainer center={[center.lat, center.lon]} zoom={9} className="map">
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <RecenterMap center={center} />
      <FocusSelected selectedKey={selectedKey} markerRefs={markerRefs} />
      <Marker position={[center.lat, center.lon]} icon={searchCenterIcon}>
        <Popup>Search location</Popup>
      </Marker>
      {flights
        .map((flight, index) => ({ flight, key: flightKey(flight, index) }))
        .filter(({ flight }) => flight.aircraftRecord.latitude !== undefined && flight.aircraftRecord.longitude !== undefined)
        .map(({ flight, key }) => {
          const { latitude, longitude, callSign, headingDegrees, baroAltitudeFt } = flight.aircraftRecord;
          return (
            <Marker
              key={key}
              position={[latitude as number, longitude as number]}
              icon={planeIcon(headingDegrees, key === selectedKey)}
              eventHandlers={{ click: () => onSelect(key) }}
              ref={(marker) => {
                if (marker) markerRefs.current.set(key, marker);
                else markerRefs.current.delete(key);
              }}
            >
              <Popup>
                <strong>{callSign || "Unknown"}</strong>
                {baroAltitudeFt !== undefined && (
                  <>
                    <br />
                    {baroAltitudeFt} ft
                  </>
                )}
              </Popup>
            </Marker>
          );
        })}
    </MapContainer>
  );
}
