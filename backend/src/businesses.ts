// Business config the backend needs for scheduling. Must match agent/<business>/knowledge-base.md.

export interface Service {
  name: string;
  durationMin: number;
}

export interface Business {
  name: string;
  bookingPrefix: string;
  callbackPrefix: string;
  chairs: number; // how many appointments can run in parallel
  // Opening hours per weekday (0 = Sunday), minutes since midnight. null = closed.
  hours: ([number, number] | null)[];
  holidays: string[]; // MM-DD, closed every year
  services: Record<string, Service>;
}

const h = (hh: number, mm = 0) => hh * 60 + mm;

const ARMENIAN_HOLIDAYS = ["01-01", "01-02", "01-06", "03-08", "04-24", "05-01", "05-09", "05-28", "07-05", "09-21", "12-31"];

export const BUSINESSES: Record<string, Business> = {
  dental: {
    name: "Smile Dental Yerevan",
    bookingPrefix: "SD",
    callbackPrefix: "CB",
    chairs: 2,
    hours: [null, [h(9), h(20)], [h(9), h(20)], [h(9), h(20)], [h(9), h(20)], [h(9), h(20)], [h(10), h(16)]],
    holidays: ARMENIAN_HOLIDAYS,
    services: {
      consultation: { name: "Consultation and exam", durationMin: 30 },
      cleaning: { name: "Professional cleaning", durationMin: 60 },
      filling: { name: "Composite filling", durationMin: 60 },
      root_canal: { name: "Root canal treatment", durationMin: 90 },
      extraction: { name: "Tooth extraction", durationMin: 45 },
      whitening: { name: "In-office teeth whitening", durationMin: 90 },
      implant_consult: { name: "Implant consultation with 3D scan", durationMin: 30 },
      ortho_consult: { name: "Orthodontic consultation", durationMin: 30 },
      kids_visit: { name: "Children's checkup", durationMin: 30 },
    },
  },
};

// Which business a platform's calls belong to when nothing else links them.
export const DEFAULT_BUSINESS_BY_PLATFORM: Record<string, string> = {
  elevenlabs: "dental",
  vapi: "auto",
};
