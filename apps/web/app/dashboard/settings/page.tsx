import { redirect } from "next/navigation";
import { resolveActingUser } from "@/lib/session";
import ProfileSettings from "../_components/ProfileSettings";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  let ctx;
  try {
    ctx = await resolveActingUser();
  } catch {
    redirect("/login");
  }
  const u = ctx.user;
  return (
    <ProfileSettings
      initial={{
        displayName: u.display_name ?? "",
        handle: u.handle ?? "",
        bio: u.bio ?? "",
        avatar: u.avatar,
        email: u.email,
      }}
      impersonating={ctx.impersonating}
    />
  );
}
