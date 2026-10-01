export interface FlightInfo {
  flightNumber: string;
  airline: string;
  from: string;
  to: string;
  departureTime: string;
  status: string;
}

export const POPULAR_FLIGHTS: FlightInfo[] = [
  {
    flightNumber: "BA249",
    airline: "British Airways",
    from: "London Heathrow (LHR)",
    to: "Rio de Janeiro (GIG)",
    departureTime: "22:15 UTC",
    status: "Scheduled",
  },
  {
    flightNumber: "AA100",
    airline: "American Airlines",
    from: "New York (JFK)",
    to: "London Heathrow (LHR)",
    departureTime: "18:30 UTC",
    status: "Scheduled",
  },
  {
    flightNumber: "UA901",
    airline: "United Airlines",
    from: "San Francisco (SFO)",
    to: "Frankfurt (FRA)",
    departureTime: "13:45 UTC",
    status: "Scheduled",
  },
  {
    flightNumber: "DL404",
    airline: "Delta Air Lines",
    from: "Atlanta (ATL)",
    to: "Paris Charles de Gaulle (CDG)",
    departureTime: "17:50 UTC",
    status: "Scheduled",
  },
  {
    flightNumber: "LH454",
    airline: "Lufthansa",
    from: "Frankfurt (FRA)",
    to: "San Francisco (SFO)",
    departureTime: "10:20 UTC",
    status: "Scheduled",
  },
  {
    flightNumber: "AF006",
    airline: "Air France",
    from: "Paris (CDG)",
    to: "New York (JFK)",
    departureTime: "14:10 UTC",
    status: "Scheduled",
  },
  {
    flightNumber: "SQ026",
    airline: "Singapore Airlines",
    from: "Singapore (SIN)",
    to: "Frankfurt (FRA)",
    departureTime: "23:55 UTC",
    status: "Scheduled",
  },
  {
    flightNumber: "EK201",
    airline: "Emirates",
    from: "Dubai (DXB)",
    to: "New York (JFK)",
    departureTime: "08:30 UTC",
    status: "Scheduled",
  },
];

export function searchFlights(query: string): FlightInfo[] {
  const q = query.trim().toUpperCase();
  if (!q) return POPULAR_FLIGHTS.slice(0, 4);
  return POPULAR_FLIGHTS.filter(
    (f) =>
      f.flightNumber.toUpperCase().includes(q) ||
      f.airline.toUpperCase().includes(q) ||
      f.from.toUpperCase().includes(q) ||
      f.to.toUpperCase().includes(q)
  );
}
