import { Link } from "react-router-dom";
import { useBrief } from "../lib/useBrief";
import { fmtEth } from "../lib/format";
import { Addr, MilestoneBadge, OrderBadge } from "./ui";

export function useOrderMeta(order) {
  const { brief, loading } = useBrief(order.briefCID);
  return {
    title: brief?.title || `Pesanan #${order.id}`,
    category: brief?.category || (loading ? "…" : "Tanpa kategori"),
    brief,
  };
}

export default function OrderCard({ order, highlight }) {
  const { title, category } = useOrderMeta(order);
  const cur = order.milestones[order.currentMilestone];
  const paid = order.milestones.filter((m) => m.status === "Paid" || m.status === "Resolved").length;
  return (
    <Link to={`/pesanan/${order.id}`} className={`card order-card ${highlight ? "highlight" : ""}`}>
      <div className="order-card-top">
        <span className={`cat cat-${category.toLowerCase()}`}>{category}</span>
        <OrderBadge status={order.status} />
      </div>
      <h3>{title}</h3>
      <div className="order-card-amount">{fmtEth(order.totalAmount)} ETH</div>
      <div className="progress">
        <div className="progress-bar" style={{ width: `${(paid / order.milestones.length) * 100}%` }} />
      </div>
      <div className="small muted">
        {paid}/{order.milestones.length} milestone selesai
        {order.status === "Active" && cur && (
          <>
            {" "}
            · M{order.currentMilestone + 1}: <MilestoneBadge status={cur.status} />
          </>
        )}
      </div>
      <div className="order-card-parties small">
        <div>
          Klien: <Addr address={order.client} plain />
        </div>
        <div>
          Freelancer: <Addr address={order.freelancer} plain />
        </div>
      </div>
      {highlight && <div className="action-hint">{highlight}</div>}
    </Link>
  );
}
