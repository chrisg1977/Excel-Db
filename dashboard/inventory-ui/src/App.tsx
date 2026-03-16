import { Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { products, locations } from './data/mockInventory';
import { ProductsPage } from './pages/ProductsPage';
import { ProductDetailPage } from './pages/ProductDetailPage';
import { LocationsPage } from './pages/LocationsPage';
import { StocktakePage } from './pages/StocktakePage';
import { MovementsPage } from './pages/MovementsPage';
import { TransferDispatchPage } from './pages/TransferDispatchPage';
import { TransferReceivePage } from './pages/TransferReceivePage';
import { TransferPendingPage } from './pages/TransferPendingPage';
import { StockByDepartmentPage } from './pages/StockByDepartmentPage';
import { StockByLocationPage } from './pages/StockByLocationPage';
import { TransferListPage } from './pages/TransferListPage';
import { ReorderSuggestionsPage } from './pages/ReorderSuggestionsPage';
import { EquipmentPlacementPage } from './pages/EquipmentPlacementPage';
import { SupplierMasterPage } from './pages/SupplierMasterPage';
import { ProcurementPage } from './pages/ProcurementPage';
import { AssetLifecyclePage } from './pages/AssetLifecyclePage';

export function App() {
  return (
    <div className="shell">
      <aside className="sidebar">
        <h1>EOS Inventory</h1>
        <nav>
          <NavLink to="/inventory/products">Products</NavLink>
          <NavLink to="/inventory/locations">Location Master</NavLink>
          <NavLink to="/inventory/stock/department">Stock by Department</NavLink>
          <NavLink to="/inventory/stock/location">Stock by Location</NavLink>
          <NavLink to="/inventory/reorder-suggestions">Reorder Suggestions</NavLink>
          <NavLink to="/inventory/equipment">Equipment Placement</NavLink>
          <NavLink to="/inventory/suppliers">Supplier Master</NavLink>
          <NavLink to="/inventory/procurement">Procurement</NavLink>
          <NavLink to="/inventory/asset-lifecycle">Asset Lifecycle</NavLink>
          <NavLink to="/inventory/movements">Movements</NavLink>
          <NavLink to="/inventory/transfers">Transfers</NavLink>
          <NavLink to="/inventory/transfers/send">Send Stock</NavLink>
          <NavLink to="/inventory/transfers/receive">Receive Transfer</NavLink>
          <NavLink to="/inventory/transfers/pending">Pending Transfers</NavLink>
        </nav>
      </aside>

      <main className="content">
        <header className="topbar">
          <input aria-label="Search" placeholder="Search SKU, title, supplier" />
          <div className="chip">Mock data spike</div>
        </header>

        <Routes>
          <Route path="/" element={<Navigate to="/inventory/products" replace />} />
          <Route path="/inventory/products" element={<ProductsPage />} />
          <Route path="/inventory/products/:productId" element={<ProductDetailPage products={products} locations={locations} />} />
          <Route path="/inventory/locations" element={<LocationsPage />} />
          <Route path="/inventory/stock/department" element={<StockByDepartmentPage />} />
          <Route path="/inventory/stock/location" element={<StockByLocationPage />} />
          <Route path="/inventory/reorder-suggestions" element={<ReorderSuggestionsPage />} />
          <Route path="/inventory/equipment" element={<EquipmentPlacementPage />} />
          <Route path="/inventory/suppliers" element={<SupplierMasterPage />} />
          <Route path="/inventory/procurement" element={<ProcurementPage />} />
          <Route path="/inventory/asset-lifecycle" element={<AssetLifecyclePage />} />
          <Route path="/inventory/locations/:locationId/stocktake" element={<StocktakePage locations={locations} products={products} />} />
          <Route path="/inventory/movements" element={<MovementsPage />} />
          <Route path="/inventory/transfers" element={<TransferListPage />} />
          <Route path="/inventory/transfers/send" element={<TransferDispatchPage />} />
          <Route path="/inventory/transfers/receive" element={<TransferReceivePage />} />
          <Route path="/inventory/transfers/pending" element={<TransferPendingPage />} />
          <Route path="*" element={<Navigate to="/inventory/products" replace />} />
        </Routes>
      </main>
    </div>
  );
}
