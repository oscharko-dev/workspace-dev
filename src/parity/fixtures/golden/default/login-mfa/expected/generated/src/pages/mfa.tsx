export default function MFA() {
  return (
    <main className="min-h-screen w-full flex flex-col gap-[12px] min-h-[844px] w-full max-w-[390px] p-[16px] bg-[#fafafc]">
      <p data-ir-id="mfa-step" data-ir-name="Step" className="w-[92px] h-[20px] text-[14px] text-[#824adb] leading-[20px] font-[600] whitespace-pre-wrap">{"Step 2 of 2"}</p>
      <h1 data-ir-id="mfa-title" data-ir-name="Title" className="w-[280px] h-[40px] text-[32px] text-[#1c1f24] leading-[40px] font-[700] whitespace-pre-wrap">{"Verify access code"}</h1>
      <p data-ir-id="mfa-body" data-ir-name="Body" className="w-[300px] h-[40px] text-[14px] text-[#3d424d] leading-[20px] font-[500] whitespace-pre-wrap">{"Enter the 6-digit code sent to your device."}</p>
      <input data-ir-id="mfa-code-field" data-ir-name="Text Field" className="flex flex-row justify-between items-center gap-[8px] min-h-[56px] w-full max-w-[358px]" type="text" name="textField" aria-label="Verification code" />
      <button data-ir-id="verify-button" data-ir-name="Primary Button" className="relative min-h-[48px] w-[220px] bg-[#ed001f]" type="button">
        <span data-ir-id="verify-button-label" data-ir-name="Label" className="absolute left-[61px] top-[13px] w-[98px] h-[22px] text-[16px] text-[#ffffff] leading-[22px] font-[600] text-center whitespace-pre-wrap">{"Verify code"}</span>
      </button>
      <p data-ir-id="mfa-help" data-ir-name="Helper" className="w-[310px] h-[40px] text-[14px] text-[#696b75] leading-[20px] font-[500] whitespace-pre-wrap">{"Need a new code? Request a new code."}</p>
    </main>
  );
}
