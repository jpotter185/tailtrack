import type { Flight } from "../lib/types";
import { flightKey } from "../lib/flightKey";
import FlightCard from "./FlightCard";

interface FlightListProps {
  flights: Flight[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
}

export default function FlightList({ flights, selectedKey, onSelect }: FlightListProps) {
  if (flights.length === 0) {
    return <p className="empty">No aircraft in range right now.</p>;
  }

  return (
    <div className="flight-list">
      {flights.map((flight, index) => {
        const key = flightKey(flight, index);
        return <FlightCard key={key} flight={flight} selected={key === selectedKey} onClick={() => onSelect(key)} />;
      })}
    </div>
  );
}
