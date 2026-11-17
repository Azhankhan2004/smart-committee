import { redirect } from "next/navigation";

// Public sign-up is disabled: the admin panel is private to the committee owner.
export default function RegisterPage() {
  redirect("/");
}
