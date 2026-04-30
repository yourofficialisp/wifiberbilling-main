const express = require('express');
const router = express.Router();
const { adminAuth } = require('./adminAuth');
const { 
    listMikrotikRouters,
    getPPPoEUsers, 
    addPPPoEUser, 
    editPPPoEUser, 
    deletePPPoEUser, 
    getPPPoEProfileeeeeeeeees, 
    addPPPoEProfileeeeeeeeee, 
    editPPPoEProfileeeeeeeeee, 
    deletePPPoEProfileeeeeeeeee, 
    getPPPoEProfileeeeeeeeeeDetail,
    getHotspotProfileeeeeeeeees,
    addHotspotProfileeeeeeeeee,
    editHotspotProfileeeeeeeeee,
    deleteHotspotProfileeeeeeeeee,
    getHotspotProfileeeeeeeeeeDetail
} = require('../config/mikrotik');
const { kickPPPoEUser } = require('../config/mikrotik2');
const fs = require('fs');
const path = require('path');
const { getSettingsWithCache } = require('../config/settingsManager');
const { getVersionInfo, getVersionBadge } = require('../config/version-utils');

function getRouterIdFromReq(req) {
  return (req.query && (req.query.routerId || req.query.router_id)) || (req.body && (req.body.routerId || req.body.router_id)) || null;
}

// GET: List User PPPoE
router.get('/mikrotik', adminAuth, async (req, res) => {
  try {
    const routerId = getRouterIdFromReq(req);
    const { routers, defaultRouterId } = listMikrotikRouters();
    const selectedRouterId = routerId || defaultRouterId || null;

    const users = await getPPPoEUsers({ routerId: selectedRouterId });
    const settings = getSettingsWithCache();
    res.render('adminMikrotik', {
      users,
      settings,
      routers,
      selectedRouterId,
      page: 'mikrotik',
      versionInfo: getVersionInfo(),
      versionBadge: getVersionBadge()
    });
  } catch (err) {
    const routerId = getRouterIdFromReq(req);
    const { routers, defaultRouterId } = listMikrotikRouters();
    const selectedRouterId = routerId || defaultRouterId || null;
    const settings = getSettingsWithCache();
    res.render('adminMikrotik', {
      users: [],
      error: 'Failed to get PPPoE user data.',
      settings,
      routers,
      selectedRouterId,
      page: 'mikrotik',
      versionInfo: getVersionInfo(),
      versionBadge: getVersionBadge()
    });
  }
});

// GET: API list of Mikrotik routers (for UI dropdown)
router.get('/mikrotik/routers', adminAuth, (req, res) => {
  try {
    const { routers, defaultRouterId } = listMikrotikRouters();
    res.json({ success: true, routers, defaultRouterId });
  } catch (err) {
    res.json({ success: false, routers: [], defaultRouterId: null, message: err.message });
  }
});

// POST: Add User PPPoE
router.post('/mikrotik/add-user', adminAuth, async (req, res) => {
  try {
    const { username, password, profile } = req.body;
    const routerId = getRouterIdFromReq(req);
    await addPPPoEUser({ username, password, profile }, { routerId });
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// POST: Edit User PPPoE
router.post('/mikrotik/edit-user', adminAuth, async (req, res) => {
  try {
    const { id, username, password, profile } = req.body;
    const routerId = getRouterIdFromReq(req);
    await editPPPoEUser({ id, username, password, profile }, { routerId });
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// POST: Delete User PPPoE
router.post('/mikrotik/delete-user', adminAuth, async (req, res) => {
  try {
    const { id } = req.body;
    const routerId = getRouterIdFromReq(req);
    await deletePPPoEUser(id, { routerId });
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// GET: List Profileeeeeeeeee PPPoE
router.get('/mikrotik/profiles', adminAuth, async (req, res) => {
  try {
    const routerId = getRouterIdFromReq(req);
    const { routers, defaultRouterId } = listMikrotikRouters();
    const selectedRouterId = routerId || defaultRouterId || null;

    const result = await getPPPoEProfileeeeeeeeees({ routerId: selectedRouterId });
    const settings = getSettingsWithCache();
    if (result.success) {
      res.render('adminMikrotikProfileeeeeeeeees', {
        profiles: result.data,
        settings,
        routers,
        selectedRouterId,
        page: 'mikrotik-profiles',
        versionInfo: getVersionInfo(),
        versionBadge: getVersionBadge()
      });
    } else {
      res.render('adminMikrotikProfileeeeeeeeees', {
        profiles: [],
        error: result.message,
        settings,
        routers,
        selectedRouterId,
        page: 'mikrotik-profiles',
        versionInfo: getVersionInfo(),
        versionBadge: getVersionBadge()
      });
    }
  } catch (err) {
    const routerId = getRouterIdFromReq(req);
    const { routers, defaultRouterId } = listMikrotikRouters();
    const selectedRouterId = routerId || defaultRouterId || null;
    const settings = getSettingsWithCache();
    res.render('adminMikrotikProfileeeeeeeeees', {
      profiles: [],
      error: 'Failed to get PPPoE profile data.',
      settings,
      routers,
      selectedRouterId,
      page: 'mikrotik-profiles',
      versionInfo: getVersionInfo(),
      versionBadge: getVersionBadge()
    });
  }
});

// GET: API List Profileeeeeeeeee PPPoE (untuk dropdown)
router.get('/mikrotik/profiles/api', adminAuth, async (req, res) => {
  try {
    const routerId = getRouterIdFromReq(req);
    const result = await getPPPoEProfileeeeeeeeees({ routerId });
    if (result.success) {
      res.json({ success: true, profiles: result.data });
    } else {
      res.json({ success: false, profiles: [], message: result.message });
    }
  } catch (err) {
    res.json({ success: false, profiles: [], message: err.message });
  }
});

// GET: API Detail Profileeeeeeeeee PPPoE
router.get('/mikrotik/profile/:id', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const routerId = getRouterIdFromReq(req);
    const result = await getPPPoEProfileeeeeeeeeeDetail(id, { routerId });
    if (result.success) {
      res.json({ success: true, profile: result.data });
    } else {
      res.json({ success: false, profile: null, message: result.message });
    }
  } catch (err) {
    res.json({ success: false, profile: null, message: err.message });
  }
});

// POST: Add Profileeeeeeeeee PPPoE
router.post('/mikrotik/add-profile', adminAuth, async (req, res) => {
  try {
    const routerId = getRouterIdFromReq(req);
    const result = await addPPPoEProfileeeeeeeeee(req.body, { routerId });
    if (result.success) {
      res.json({ success: true });
    } else {
      res.json({ success: false, message: result.message });
    }
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// POST: Edit Profileeeeeeeeee PPPoE
router.post('/mikrotik/edit-profile', adminAuth, async (req, res) => {
  try {
    const routerId = getRouterIdFromReq(req);
    const result = await editPPPoEProfileeeeeeeeee(req.body, { routerId });
    if (result.success) {
      res.json({ success: true });
    } else {
      res.json({ success: false, message: result.message });
    }
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// POST: Delete Profileeeeeeeeee PPPoE
router.post('/mikrotik/delete-profile', adminAuth, async (req, res) => {
  try {
    const { id } = req.body;
    const routerId = getRouterIdFromReq(req);
    const result = await deletePPPoEProfileeeeeeeeee(id, { routerId });
    if (result.success) {
      res.json({ success: true });
    } else {
      res.json({ success: false, message: result.message });
    }
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// GET: List Profileeeeeeeeee Hotspot
router.get('/mikrotik/hotspot-profiles', adminAuth, async (req, res) => {
  try {
    const routerId = getRouterIdFromReq(req);
    const { routers, defaultRouterId } = listMikrotikRouters();
    const selectedRouterId = routerId || defaultRouterId || null;

    const result = await getHotspotProfileeeeeeeeees({ routerId: selectedRouterId });
    const settings = getSettingsWithCache();
    if (result.success) {
      res.render('adminMikrotikHotspotProfileeeeeeeeees', {
        profiles: result.data,
        settings,
        routers,
        selectedRouterId,
        page: 'hotspot-profiles',
        versionInfo: getVersionInfo(),
        versionBadge: getVersionBadge()
      });
    } else {
      res.render('adminMikrotikHotspotProfileeeeeeeeees', {
        profiles: [],
        error: result.message,
        settings,
        routers,
        selectedRouterId,
        page: 'hotspot-profiles',
        versionInfo: getVersionInfo(),
        versionBadge: getVersionBadge()
      });
    }
  } catch (err) {
    const routerId = getRouterIdFromReq(req);
    const { routers, defaultRouterId } = listMikrotikRouters();
    const selectedRouterId = routerId || defaultRouterId || null;
    const settings = getSettingsWithCache();
    res.render('adminMikrotikHotspotProfileeeeeeeeees', {
      profiles: [],
      error: 'Failed to get Hotspot profile data.',
      settings,
      routers,
      selectedRouterId,
      page: 'hotspot-profiles',
      versionInfo: getVersionInfo(),
      versionBadge: getVersionBadge()
    });
  }
});

// GET: API List Profileeeeeeeeee Hotspot
router.get('/mikrotik/hotspot-profiles/api', adminAuth, async (req, res) => {
  try {
    const routerId = getRouterIdFromReq(req);
    const result = await getHotspotProfileeeeeeeeees({ routerId });
    if (result.success) {
      res.json({ success: true, profiles: result.data });
    } else {
      res.json({ success: false, profiles: [], message: result.message });
    }
  } catch (err) {
    res.json({ success: false, profiles: [], message: err.message });
  }
});

// GET: API Detail Profileeeeeeeeee Hotspot
router.get('/mikrotik/hotspot-profiles/detail/:id', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const routerId = getRouterIdFromReq(req);
    const result = await getHotspotProfileeeeeeeeeeDetail(id, { routerId });
    if (result.success) {
      res.json({ success: true, profile: result.data });
    } else {
      res.json({ success: false, profile: null, message: result.message });
    }
  } catch (err) {
    res.json({ success: false, profile: null, message: err.message });
  }
});

// POST: Add Profileeeeeeeeee Hotspot
router.post('/mikrotik/hotspot-profiles/add', adminAuth, async (req, res) => {
  try {
    const routerId = getRouterIdFromReq(req);
    const result = await addHotspotProfileeeeeeeeee(req.body, { routerId });
    if (result.success) {
      res.json({ success: true });
    } else {
      res.json({ success: false, message: result.message });
    }
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// POST: Edit Profileeeeeeeeee Hotspot
router.post('/mikrotik/hotspot-profiles/edit', adminAuth, async (req, res) => {
  try {
    const routerId = getRouterIdFromReq(req);
    const result = await editHotspotProfileeeeeeeeee(req.body, { routerId });
    if (result.success) {
      res.json({ success: true });
    } else {
      res.json({ success: false, message: result.message });
    }
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// POST: Delete Profileeeeeeeeee Hotspot
router.post('/mikrotik/hotspot-profiles/delete', adminAuth, async (req, res) => {
  try {
    const { id } = req.body;
    const routerId = getRouterIdFromReq(req);
    const result = await deleteHotspotProfileeeeeeeeee(id, { routerId });
    if (result.success) {
      res.json({ success: true });
    } else {
      res.json({ success: false, message: result.message });
    }
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// POST: Putuskan sesi PPPoE user
router.post('/mikrotik/disconnect-session', adminAuth, async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) return res.json({ success: false, message: 'Username tidak boleh kosong' });
    const result = await kickPPPoEUser(username);
    res.json(result);
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// GET: Get PPPoE user statistics
router.get('/mikrotik/user-stats', adminAuth, async (req, res) => {
  try {
    const routerId = getRouterIdFromReq(req);
    const users = await getPPPoEUsers({ routerId });
    const totalUsers = Array.isArray(users) ? users.length : (users ? 1 : 0);
    const activeUsers = Array.isArray(users) ? users.filter(u => u.active).length : (users && users.active ? 1 : 0);
    const offlineUsers = totalUsers - activeUsers;
    
    res.json({ 
      success: true, 
      totalUsers, 
      activeUsers, 
      offlineUsers 
    });
  } catch (err) {
    console.error('Error getting PPPoE user stats:', err);
    res.status(500).json({ 
      success: false, 
      message: err.message,
      totalUsers: 0,
      activeUsers: 0,
      offlineUsers: 0
    });
  }
});

// POST: Restart Mikrotik
router.post('/mikrotik/restart', adminAuth, async (req, res) => {
  try {
    const { restartRouter } = require('../config/mikrotik');
    const routerId = getRouterIdFromReq(req);
    const result = await restartRouter({ routerId });
    if (result.success) {
      res.json({ success: true, message: result.message });
    } else {
      res.json({ success: false, message: result.message });
    }
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

module.exports = router;
