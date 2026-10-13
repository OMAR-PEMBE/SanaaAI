export default function PrivacyPage() {
  return (
    <article className="mx-auto flex max-w-2xl flex-col gap-4 text-base leading-relaxed">
      <h1 className="text-3xl font-semibold tracking-tight">Privacy</h1>
      <p>SanaaAI stores the name, email, and password hash you use to sign in, plus the credits, payments, and creations on your account.</p>
      <p>Mobile-money phone numbers are sent to the payment provider to start a top-up. They are not stored on your account. Payment records keep the amount, status, and a provider reference.</p>
      <p>Creations stay private until you share them to Explore. A hidden creation is removed from Explore. Downloads use a short-lived link.</p>
      <p>The prompt and any image you submit are sent to a third-party service that creates the result. That service is not named here. The result is stored on your account.</p>
      <p>The access token stays in this browser and expires after 15 minutes. Logging out ends that session.</p>
      <p>This page describes the local product behavior. A production privacy contact is added when the operating company and domain are chosen.</p>
    </article>
  );
}
