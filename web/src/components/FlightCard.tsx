import { useEffect, useRef } from "react";
import type { Flight } from "../lib/types";

interface FlightCardProps {
  flight: Flight;
  selected: boolean;
  onClick: () => void;
}

export default function FlightCard({ flight, selected, onClick }: FlightCardProps) {
  const { aircraftRecord: ac, routeInfo, flightRadarUrl } = flight;
  const hasRoute = routeInfo && (routeInfo.originAirportIata || routeInfo.destinationAirportIata);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selected) {
      cardRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [selected]);

  return (
    <div ref={cardRef} className={`flight-card${selected ? " selected" : ""}`} onClick={onClick}>
      <div className="flight-card-header">
        <span className="callsign">{ac.callSign || ac.registration || "Unknown"}</span>
        {flightRadarUrl && (
          <a href={flightRadarUrl} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
            Track ↗
          </a>
        )}
      </div>
      {ac.aircraftDescription && <p className="aircraft-type">{ac.aircraftDescription}</p>}
      {hasRoute && (
        <p className="route">
          {routeInfo.originAirportIata ?? routeInfo.originAirportIcao ?? "?"}
          {" → "}
          {routeInfo.destinationAirportIata ?? routeInfo.destinationAirportIcao ?? "?"}
          {routeInfo.airlineName && ` · ${routeInfo.airlineName}`}
        </p>
      )}
      <div className="flight-stats">
        {ac.baroAltitudeFt !== undefined && <span>{ac.baroAltitudeFt} ft</span>}
        {ac.groundSpeedKt !== undefined && <span>{Math.round(ac.groundSpeedKt)} kt</span>}
        {ac.distanceNm !== undefined && <span>{ac.distanceNm.toFixed(1)} nm away</span>}
      </div>
    </div>
  );
}
