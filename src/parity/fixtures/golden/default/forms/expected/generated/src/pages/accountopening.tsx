export default function AccountOpening() {
  return (
    <main className="min-h-screen w-full flex flex-col gap-[16px] min-h-[900px] w-full max-w-[420px] p-[24px] bg-[#ffffff]">
      <h1 data-ir-id="form-title" data-ir-name="Heading" className="w-[250px] h-[36px] text-[28px] text-[#1c1f24] leading-[36px] font-[700] whitespace-pre-wrap">{"Open Treasury Account"}</h1>
      <p data-ir-id="form-subtitle" data-ir-name="Subtitle" className="w-[300px] h-[20px] text-[14px] text-[#666b75] leading-[20px] font-[400] whitespace-pre-wrap">{"Synthetic onboarding form for demo review"}</p>
      <table data-ir-id="name-row" data-ir-name="Name Row" className="flex flex-row justify-start items-center gap-[12px] min-h-[56px] w-[372px]">
        <input data-ir-id="first-name-field" data-ir-name="Text Field" className="flex flex-col gap-[4px] min-h-[56px] w-[180px] border border-[#bfc4cc] rounded-[8px]" type="text" name="textField" aria-label="Legal Entity" />
        <input data-ir-id="last-name-field" data-ir-name="Text Field" className="flex flex-col gap-[4px] min-h-[56px] w-[180px] border border-[#bfc4cc] rounded-[8px]" type="text" name="textField" aria-label="Region" />
      </table>
      <input data-ir-id="email-field" data-ir-name="Text Field" className="flex flex-col gap-[4px] min-h-[56px] w-[372px] border border-[#bfc4cc] rounded-[8px]" type="text" name="textField" aria-label="Contact Email" />
      <section data-ir-id="checkbox-row" data-ir-name="Checkbox Row" className="flex flex-row justify-start items-center gap-[8px] min-h-[24px] w-[372px]">
        <div data-ir-id="checkbox-icon" data-ir-name="Checkbox" className="w-[24px] h-[24px] border border-[#ed001f] rounded-[4px]" />
        <p data-ir-id="checkbox-label" data-ir-name="Label" className="w-[280px] h-[20px] text-[14px] text-[#1c1f24] leading-[20px] font-[400] whitespace-pre-wrap">{"I confirm the demo data is synthetic"}</p>
      </section>
      <button data-ir-id="submit-button" data-ir-name="Primary Button" className="flex flex-row justify-center items-center min-h-[48px] w-[372px] bg-[#ed001f] rounded-[8px]" type="button">
        <span data-ir-id="submit-label" data-ir-name="Label" className="w-[148px] h-[22px] text-[16px] text-[#ffffff] leading-[22px] font-[600] text-center whitespace-pre-wrap">{"Open Treasury Account"}</span>
      </button>
    </main>
  );
}
