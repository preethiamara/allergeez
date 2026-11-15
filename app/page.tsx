import AllerGeezApp from "./AllerGeezApp";
import { getActor } from "@/lib/session";
import { getProfile, listMeals, listReactions, type Meal, type Profile, type Reaction } from "@/lib/records";

export const dynamic = "force-dynamic";

export default async function Page() {
  let meals: Meal[] = [], reactions: Reaction[] = [];
  let profile: Profile = { allergens: [], contact_name: "", contact_phone: "" };
  let loadError: string | undefined;
  const { userId, user } = await getActor();
  try {
    [meals, reactions, profile] = await Promise.all([listMeals(userId), listReactions(userId), getProfile(userId)]);
  } catch (e: any) {
    console.error("[page] initial load", e);
    loadError = "Couldn’t load your saved history. Check your connection and refresh.";
  }
  return <AllerGeezApp user={user} initialMeals={meals} initialReactions={reactions} initialProfile={profile} loadError={loadError} />;
}
