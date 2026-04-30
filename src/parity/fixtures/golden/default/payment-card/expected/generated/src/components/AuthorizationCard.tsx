interface AuthorizationCardProps {
  irId: string;
  irName: string;
  imageIrId: string;
  imageIrName: string;
  infoIrId: string;
  infoIrName: string;
  paymentTitleIrId: string;
  paymentTitleIrName: string;
  approvalContextIrId: string;
  approvalContextIrName: string;
  amountIrId: string;
  amountIrName: string;
  paymentTitle: string;
  approvalContext: string;
  amount: string;
}

export default function AuthorizationCard(props: Readonly<AuthorizationCardProps>) {
  return (
    <article data-ir-id={props.irId} data-ir-name={props.irName} className="flex flex-row items-center gap-[12px] min-h-[100px] w-full max-w-[358px] bg-[#ffffff] rounded-[8px]">
      <img data-ir-id={props.imageIrId} data-ir-name={props.imageIrName} className="w-[76px] h-[76px] bg-[#e6e8ed]" alt="Image" src="" />
      <ul data-ir-id={props.infoIrId} data-ir-name={props.infoIrName} className="flex flex-col gap-[4px] min-h-[76px] w-[240px]">
        <li data-ir-id={props.paymentTitleIrId} data-ir-name={props.paymentTitleIrName} className="w-full max-w-[240px] h-[24px] text-[16px] text-[#1c1f24] leading-[24px] font-[600] whitespace-pre-wrap">{props.paymentTitle}</li>
        <li data-ir-id={props.approvalContextIrId} data-ir-name={props.approvalContextIrName} className="w-full max-w-[240px] h-[20px] text-[14px] text-[#666b75] leading-[20px] font-[400] whitespace-pre-wrap">{props.approvalContext}</li>
        <li data-ir-id={props.amountIrId} data-ir-name={props.amountIrName} className="w-[80px] h-[24px] text-[16px] text-[#1778f2] leading-[24px] font-[700] whitespace-pre-wrap">{props.amount}</li>
      </ul>
    </article>
  );
}
