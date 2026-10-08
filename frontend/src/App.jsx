import { Routes, Route } from "react-router-dom";
import { Navbar, Banners, Footer } from "./components/Layout";
import Beranda from "./pages/Beranda";
import BuatPesanan from "./pages/BuatPesanan";
import DetailPesanan from "./pages/DetailPesanan";
import { DashboardArbiter, DashboardFreelancer, DashboardKlien } from "./pages/Dashboards";

export default function App() {
  return (
    <div className="app">
      <Navbar />
      <Banners />
      <main>
        <Routes>
          <Route path="/" element={<Beranda />} />
          <Route path="/buat" element={<BuatPesanan />} />
          <Route path="/klien" element={<DashboardKlien />} />
          <Route path="/freelancer" element={<DashboardFreelancer />} />
          <Route path="/arbiter" element={<DashboardArbiter />} />
          <Route path="/pesanan/:id" element={<DetailPesanan />} />
          <Route path="*" element={<div className="container"><h1>Halaman tidak ditemukan</h1></div>} />
        </Routes>
      </main>
      <Footer />
    </div>
  );
}
