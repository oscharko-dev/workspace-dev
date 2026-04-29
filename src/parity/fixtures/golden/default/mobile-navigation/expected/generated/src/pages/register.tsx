export default function Register() {
  return (
    <main className="min-h-screen w-full flex flex-col gap-[16px] min-h-[844px] w-full max-w-[390px] px-[24px] pt-[48px] pb-[24px] bg-[#ffffff]">
      <h1 data-ir-id="reg-title" data-ir-name="Title" className="w-[342px] h-[36px] text-[28px] text-[#1c1f24] leading-[36px] font-[700] whitespace-pre-wrap">{"Create Account"}</h1>
      <input data-ir-id="reg-name" data-ir-name="MuiFormControlRoot" className="flex flex-row justify-between items-center gap-[8px] min-h-[56px] w-[342px]" type="text" name="muiFormControlRoot" aria-label="Full Name" />
    </main>
  );
}
