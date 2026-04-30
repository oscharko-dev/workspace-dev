export default function RiskAlertModal() {
  return (
    <main className="min-h-screen w-full grid grid-cols-2 gap-[56px] min-h-[416px] w-full max-w-[576px] bg-[#ffffff]">
      <span data-ir-id="risk-severity-badge" data-ir-name="Severity Badge" className="relative min-h-[32px] w-[128px] bg-[#ffe8d1] rounded-[16px]">
        <p data-ir-id="risk-severity-label" data-ir-name="Label" className="absolute left-[20px] top-[7px] w-[88px] h-[18px] text-[13px] text-[#ad4a05] leading-[18px] font-[700] text-center whitespace-pre-wrap">{"High Risk"}</p>
      </span>
      <h1 data-ir-id="risk-title" data-ir-name="Modal Title" className="w-[360px] h-[36px] text-[28px] text-[#1c1f24] leading-[36px] font-[700] whitespace-pre-wrap" role="dialog" aria-modal="true" aria-label="Review payment anomaly">{"Review payment anomaly"}</h1>
      <p data-ir-id="risk-body" data-ir-name="Modal Body" className="w-[448px] h-[56px] text-[16px] text-[#575c66] leading-[28px] font-[400] whitespace-pre-wrap" role="dialog" aria-modal="true" aria-label="Synthetic rule hit payment velocity exceeds the configured demo threshold for this segment">{"Synthetic rule hit: payment velocity exceeds the configured demo threshold for this segment."}</p>
      <article data-ir-id="risk-summary-panel" data-ir-name="Risk Summary Panel" className="relative min-h-[72px] w-[448px] bg-[#f7faff] rounded-[12px]">
        <p data-ir-id="risk-summary-label" data-ir-name="Label" className="absolute left-[20px] top-[14px] w-[180px] h-[20px] text-[14px] text-[#666b75] leading-[20px] font-[500] whitespace-pre-wrap">{"Exposure under review"}</p>
        <p data-ir-id="risk-summary-value" data-ir-name="Value" className="absolute left-[20px] top-[38px] w-[280px] h-[28px] text-[20px] text-[#1c1f24] leading-[28px] font-[700] whitespace-pre-wrap">{"EUR 2.4M synthetic portfolio"}</p>
      </article>
      <section data-ir-id="risk-actions" data-ir-name="Action Row" className="flex flex-row justify-start items-center gap-[12px] min-h-[48px] w-[264px]">
        <button data-ir-id="risk-secondary-button" data-ir-name="Secondary Button" className="relative min-h-[48px] w-[120px] border border-[#bdc4d1] rounded-[8px]" type="button">
          <span data-ir-id="risk-secondary-label" data-ir-name="Label" className="absolute left-[32px] top-[13px] w-[56px] h-[22px] text-[16px] text-[#1c1f24] leading-[22px] font-[600] text-center whitespace-pre-wrap">{"Dismiss"}</span>
        </button>
        <button data-ir-id="risk-primary-button" data-ir-name="Primary Button" className="relative min-h-[48px] w-[132px] bg-[#ed001f] rounded-[8px]" type="button">
          <span data-ir-id="risk-primary-label" data-ir-name="Label" className="absolute left-[24px] top-[13px] w-[84px] h-[22px] text-[16px] text-[#ffffff] leading-[22px] font-[600] text-center whitespace-pre-wrap">{"Open Case"}</span>
        </button>
      </section>
    </main>
  );
}
