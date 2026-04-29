export default function DashboardDark() {
  return (
    <main className="min-h-screen w-full flex flex-col gap-[20px] min-h-[844px] w-full max-w-[390px] p-[24px] bg-[#12141c]">
      <h1 data-ir-id="dark-title" data-ir-name="Heading" className="w-[280px] h-[36px] text-[28px] text-[#f5f7fa] leading-[36px] font-[700] whitespace-pre-wrap">{"Operations Dashboard"}</h1>
      <p data-ir-id="dark-body" data-ir-name="Body" className="w-[320px] h-[48px] text-[16px] text-[#b3bac7] leading-[24px] font-[400] whitespace-pre-wrap">{"Track shipment delays, alerts, and approvals in one place."}</p>
      <article data-ir-id="dark-summary-card" data-ir-name="Summary Card" className="flex flex-col gap-[8px] min-h-[144px] w-[342px] p-[16px] bg-[#1f242e] rounded-[16px]">
        <p data-ir-id="dark-card-title" data-ir-name="Label" className="w-[96px] h-[20px] text-[14px] text-[#a6adba] leading-[20px] font-[500] whitespace-pre-wrap">{"Open incidents"}</p>
        <p data-ir-id="dark-card-value" data-ir-name="Value" className="w-[220px] h-[32px] text-[24px] text-[#f5f7fa] leading-[32px] font-[700] whitespace-pre-wrap">{"14 urgent reviews"}</p>
      </article>
    </main>
  );
}
