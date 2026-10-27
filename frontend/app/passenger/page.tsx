"use client";export default function PassengerDashboard(){return null;}
function PassengerInner() {
  const { user, logout } = useSession();
  const isPassenger = user?.roles?.includes("passenger") ?? false;
  const navigate = useNavigate();
  const searchParams = useSearchParams();

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [myTrips, setMyTrips] = useState<any[]>([]);
  const [myBookings, setMyBookings] = useState<any[]>([]);
  const [rating, setRating] = useState<{ avg: number | null; count: number }>({ avg: null, count: 0 });
  const [fuel, setFuel] = useState<{ petrol: number; diesel: number } | null>(null);
  const [estimate, setEstimate] = useState<DistanceEstimate | null>(null);
  const [distErr, setDistErr] = useState<string | null>(null);
  const [fromLat, setFromLat] = useState("");
  const [fromLng, setFromLng] = useState("");
  const [toLat, setToLat] = useState("");
  const [toLng, setToLng] = useState("");
  const [searchRides, setSearchRides] = useState<any[] | null>(null);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  const [showSOS, setShowSOS] = useState(false);

  const load = useCallback(async () => {
    setErr(null);
    try {
      await Promise.all([
        tripApi.mine().then(setMyTrips).catch(() => setMyTrips([])),
        ratingApi.forUser(user?.id ?? "").then((r) => setRating({ avg: r.rating_avg ?? null, count: r.rating_count })).catch(() => setRating({ avg: null, count: 0 })),
        fuelApi.price().then(setFuel).catch(() => setFuel(null)),
      ]);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Load failed");
    } finally { setLoading(false); }
  }, [user?.id]);

  useEffect(() => { if (isPassenger) load(); }, [isPassenger, load]);

  if (loading) {
    return (<PageShell title="Passenger Dashboard" eyebrow="Passenger" wide><div className="flex items-center justify-center py-12"><span className="loader"></span> Loading…</div></PageShell>);
  }
  if (!isPassenger) { return (<PageShell title="Passenger Dashboard" eyebrow="Passenger"><p className="text-muted text-center py-12">Passenger role required.</p></PageShell>); }

  const estimateTrip = async () => {
    setDistErr(null);
    if (!fromLat || !fromLng || !toLat || !toLng) { setDistErr("Pick both from and to points"); return; }
    try { const e = await fuelApi.distance({ from_lat: Number(fromLat), from_lng: Number(fromLng), to_lat: Number(toLat), to_lng: Number(toLng), seats: 1 }); setEstimate(e); } catch (e: unknown) { setDistErr(e instanceof Error ? e.message : "Estimate failed"); }
  };

  const handleSearch = async () => {
    setSearchErr(null);
    if (!fromLat || !fromLng || !toLat || !toLng || !searchParams.get("date")) { setSearchErr("Enter from, to, and date"); return; }
    try { setSearchRides([]); setSearchErr("No rides found for these criteria"); } catch (e: unknown) { setSearchErr(e instanceof Error ? e.message : "Search failed"); }
  };

  const totalFare = 200;
  const nRiders = 2;