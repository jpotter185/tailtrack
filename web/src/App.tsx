import { useState } from "react";
import SearchForm, { type SearchParams } from "./components/SearchForm";
import MapView from "./components/MapView";
import FlightList from "./components/FlightList";
import { fetchFlights } from "./lib/api";
import type { Flight } from "./lib/types";
import "./styles.css";

export default function App() {
  const [flights, setFlights] = useState<Flight[]>([]);
  const [center, setCenter] = useState<{ lat: number; lon: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  async function handleSearch(params: SearchParams) {
    setLoading(true);
    setError(null);
    setSelectedKey(null);
    try {
      const results = await fetchFlights(params);
      setFlights(results);
      setCenter({ lat: params.lat, lon: params.lon });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app">
      <header>
        <h1>Tailtrack</h1>
        <p>See what's flying overhead.</p>
      </header>
      <SearchForm onSearch={handleSearch} loading={loading} />
      {error && <p className="error">{error}</p>}
      {center && (
        <div className="results">
          <MapView center={center} flights={flights} selectedKey={selectedKey} onSelect={setSelectedKey} />
          <FlightList flights={flights} selectedKey={selectedKey} onSelect={setSelectedKey} />
        </div>
      )}
    </div>
  );
}
