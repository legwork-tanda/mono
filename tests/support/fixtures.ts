import { DEMO_USER_ID, type User } from "@/lib/job-service";

export const demoUser: User = {
  id: DEMO_USER_ID,
  name: "Alex Demo",
  homeAddress: {
    label: "12 Brunswick St, Fortitude Valley QLD 4006",
    lat: -27.4575,
    lng: 153.0355,
  },
};
