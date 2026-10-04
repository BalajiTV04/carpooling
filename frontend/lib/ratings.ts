// Ratings client (Module 22): the trust layer on completed rides.
// A rating is only possible once a ride is `completed`, and one person gets
// one vote per booking — re-posting the same booking edits your review.
export type Rating = {
  id: string; booking_id: string; trip_id: string;
  rater_id: string; target_id: string;
  stars: number; comment: string | null;
  created_at: string | null; updated_at: string | null;
  rater_name: string | null; target_name: string | null;
  // returned on write so the card can update without a second fetch
  target_rating_avg?: number | null; target_rating_count?: number;
};

export type RatingCard = {
  user_id: string; full_name: string | null; roles: string[];
  rating_avg: number | null; rating_count: number;
  distribution: Record<string, number>;
  items: Rating[];
};

// One completed ride I was part of + the score I already gave it.
export type PendingRating = {
  booking_id: string; trip_id: string; target_id: string; target_name: string | null;
  seats: number; closed_at: string | null; my_stars: number | null;
  trip: { source_name: string | null; destination_name: string | null; depart_at: string | null } | null;
};

export type PendingList = { count: number; unrated: number; items: PendingRating[] };

function base() {
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";
}

async function req(path: string, opts: RequestInit = {}) {
  const token = typeof window !== "undefined" ? localStorage.getItem("voltride_token") : null;
  const res = await fetch(`${base()}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers ?? {})
    }
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.detail ?? `Request failed (${res.status})`);
  return body;
}

export const ratingApi = {
  rate: (b: { booking_id: string; stars: number; comment?: string }): Promise<Rating> =>
    req("/ratings", { method: "POST", body: JSON.stringify(b) }),
  pending: (): Promise<PendingList> => req("/ratings/pending"),
  forBooking: (bookingId: string): Promise<{ booking_id: string; count: number; items: Rating[] }> =>
    req(`/ratings/booking/${bookingId}`),
  forUser: (userId: string, limit = 20): Promise<RatingCard> =>
    req(`/ratings/user/${userId}?limit=${limit}`)
};

export const STAR_LABELS: Record<number, string> = {
  1: "Poor", 2: "Below par", 3: "Fine", 4: "Great", 5: "Excellent"
};