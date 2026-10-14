import { Incident } from '../models/Incident.js';
import { Responder } from '../models/Responder.js';
import { User } from '../models/User.js';
import { isDbConnected } from '../config/db.js';

export const getDashboardSummary = async (req, res, next) => {
  try {
    const totalIncidents = await Incident.countDocuments();
    const activeIncidents = await Incident.countDocuments({
      status: { $in: ['Submitted', 'Acknowledged', 'Assigned', 'Dispatched', 'On Scene'] }
    });
    const criticalIncidents = await Incident.countDocuments({
      severity: 'critical',
      status: { $in: ['Submitted', 'Acknowledged', 'Assigned', 'Dispatched', 'On Scene'] }
    });
    const resolvedIncidents = await Incident.countDocuments({ status: 'Resolved' });

    // Calculate real average response time in minutes from genuine timestamps
    // Response time = time from reportedAt to acknowledgedAt (or dispatchedAt)
    const acknowledgedList = await Incident.find({
      reportedAt: { $ne: null },
      acknowledgedAt: { $ne: null }
    }).select('reportedAt acknowledgedAt');

    let totalResponseMinutes = 0;
    let validResponseCount = 0;

    for (const inc of acknowledgedList) {
      if (inc.acknowledgedAt && inc.reportedAt) {
        const diffMs = new Date(inc.acknowledgedAt) - new Date(inc.reportedAt);
        if (diffMs >= 0) {
          totalResponseMinutes += diffMs / (1000 * 60);
          validResponseCount++;
        }
      }
    }

    const avgResponseTimeMinutes = validResponseCount > 0
      ? (totalResponseMinutes / validResponseCount).toFixed(1)
      : '0.0';

    // Responder fleet readiness
    const totalResponders = await Responder.countDocuments();
    const availableResponders = await Responder.countDocuments({ availabilityStatus: 'available' });
    const dispatchedResponders = await Responder.countDocuments({ availabilityStatus: 'dispatched' });

    // User counts
    const totalUsers = await User.countDocuments();

    res.json({
      success: true,
      summary: {
        totalIncidents,
        activeIncidents,
        criticalIncidents,
        resolvedIncidents,
        avgResponseTimeMinutes: parseFloat(avgResponseTimeMinutes),
        fleet: {
          total: totalResponders,
          available: availableResponders,
          dispatched: dispatchedResponders
        },
        totalUsers,
        dbConnected: isDbConnected(),
        serverUptimeSeconds: Math.floor(process.uptime())
      }
    });
  } catch (error) {
    next(error);
  }
};

export const getRecentIncidents = async (req, res, next) => {
  try {
    const incidents = await Incident.find()
      .populate('reporter', 'name email phone identifier department')
      .populate({
        path: 'assignedResponder',
        populate: { path: 'user', select: 'name phone' }
      })
      .sort({ reportedAt: -1 })
      .limit(10);

    res.json({
      success: true,
      incidents
    });
  } catch (error) {
    next(error);
  }
};

export const getIncidentTrends = async (req, res, next) => {
  try {
    // Category distribution
    const categoryStats = await Incident.aggregate([
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } }
    ]);

    // Severity distribution
    const severityStats = await Incident.aggregate([
      {
        $group: {
          _id: '$severity',
          count: { $sum: 1 }
        }
      }
    ]);

    // Status breakdown
    const statusStats = await Incident.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    // Daily trends for the last 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const dailyTrends = await Incident.aggregate([
      {
        $match: {
          reportedAt: { $gte: sevenDaysAgo }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$reportedAt' }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    res.json({
      success: true,
      trends: {
        categoryDistribution: categoryStats.map((c) => ({ category: c._id, count: c.count })),
        severityDistribution: severityStats.map((s) => ({ severity: s._id, count: s.count })),
        statusDistribution: statusStats.map((st) => ({ status: st._id, count: st.count })),
        dailyTrends: dailyTrends.map((d) => ({ date: d._id, count: d.count }))
      }
    });
  } catch (error) {
    next(error);
  }
};
