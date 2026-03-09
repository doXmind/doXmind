"use client";

import { useEffect } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";

/**
 * Legacy route — redirects to unified /s/[token] page.
 * Kept for backward compatibility with old links.
 */
export default function CommunityDetailRedirect() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = params.token as string;

  useEffect(() => {
    const qs = searchParams.toString();
    router.replace(`/s/${token}${qs ? `?${qs}` : ""}`);
  }, [token, searchParams, router]);

  return null;
}
