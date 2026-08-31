import type { Metadata } from "next";
import { UpdatePasswordScreen } from "@/components/auth-screens";

export const metadata: Metadata = { title: "Choose a new password" };

export default function UpdatePasswordPage() {
  return <UpdatePasswordScreen />;
}
