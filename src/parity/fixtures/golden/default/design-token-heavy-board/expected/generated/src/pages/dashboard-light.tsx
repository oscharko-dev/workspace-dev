export default function DashboardLight() {
  return (
    <main className="min-h-screen w-full flex flex-col gap-[20px] min-h-[844px] w-full max-w-[390px] p-[24px] bg-[#fafafc]">
      <h1 data-ir-id="light-title" data-ir-name="Heading" className="w-[280px] h-[36px] text-[28px] text-[#1c1f24] leading-[36px] font-[700] whitespace-pre-wrap">{"Risk Operations"}</h1>
      <p data-ir-id="light-body" data-ir-name="Body" className="w-[320px] h-[48px] text-[16px] text-[#545c66] leading-[24px] font-[400] whitespace-pre-wrap">{"Track exposure alerts, payment holds, and approvals."}</p>
      <article data-ir-id="light-summary-card" data-ir-name="Summary Card" className="flex flex-col gap-[8px] min-h-[144px] w-[342px] p-[16px] bg-[#ffffff] rounded-[16px]">
        <p data-ir-id="light-card-title" data-ir-name="Label" className="w-[96px] h-[20px] text-[14px] text-[#666b75] leading-[20px] font-[500] whitespace-pre-wrap">{"Open risk alerts"}</p>
        <p data-ir-id="light-card-value" data-ir-name="Value" className="w-[220px] h-[32px] text-[24px] text-[#1c1f24] leading-[32px] font-[700] whitespace-pre-wrap">{"14 urgent reviews"}</p>
      </article>
    </main>
  );
}
