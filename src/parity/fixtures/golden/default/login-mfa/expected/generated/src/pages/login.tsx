export default function Login() {
  return (
    <main className="min-h-screen w-full flex flex-col gap-[12px] min-h-[844px] w-full max-w-[390px] p-[16px] bg-[#fafafc]">
      <h1 data-ir-id="login-title" data-ir-name="Title" className="w-[220px] h-[40px] text-[32px] text-[#1c1f24] leading-[40px] font-[700] whitespace-pre-wrap">{"Secure Continue"}</h1>
      <input data-ir-id="email-field" data-ir-name="Text Field" className="flex flex-row justify-between items-center gap-[8px] min-h-[56px] w-full max-w-[358px]" type="text" name="textField" aria-label="Work Email" />
      <button data-ir-id="submit-button" data-ir-name="Primary Button" className="relative min-h-[48px] w-[220px] bg-[#ed001f]" type="button">
        <span data-ir-id="submit-button-label" data-ir-name="Label" className="absolute left-[68px] top-[13px] w-[90px] h-[22px] text-[16px] text-[#ffffff] leading-[22px] font-[600] text-center whitespace-pre-wrap">{"Continue"}</span>
      </button>
    </main>
  );
}
