/**
 * @fileOverview
 * @author Laura Lindzey - lindzey@gmail.com
 */

import Topic from "../core/Topic.js";
import Message from "../core/Message.js";
import EventEmitter2 from "eventemitter2";

/**
 * An actionlib action server client.
 *
 * Emits the following events:
 *  * 'goal' - goal sent by action client
 *  * 'cancel' - action client has canceled the request
 *
 *  @constructor
 *  @param options - object with following keys:
 *   * ros - the ROSLIB.Ros connection handle
 *   * serverName - the action server name, like /fibonacci
 *   * actionName - the action message name, like 'actionlib_tutorials/FibonacciAction'
 */

function SimpleActionServer(options) {
  var that = this;
  options = options || {};
  this.ros = options.ros;
  this.serverName = options.serverName;
  this.actionName = options.actionName;

  // create and advertise publishers
  this.feedbackPublisher = new Topic({
    ros: this.ros,
    name: this.serverName + "/feedback",
    messageType: this.actionName + "Feedback",
  });
  this.feedbackPublisher.advertise();

  var statusPublisher = new Topic({
    ros: this.ros,
    name: this.serverName + "/status",
    messageType: "actionlib_msgs/GoalStatusArray",
  });
  statusPublisher.advertise();

  this.resultPublisher = new Topic({
    ros: this.ros,
    name: this.serverName + "/result",
    messageType: this.actionName + "Result",
  });
  this.resultPublisher.advertise();

  // create and subscribe to listeners
  var goalListener = new Topic({
    ros: this.ros,
    name: this.serverName + "/goal",
    messageType: this.actionName + "Goal",
  });

  var cancelListener = new Topic({
    ros: this.ros,
    name: this.serverName + "/cancel",
    messageType: "actionlib_msgs/GoalID",
  });

  // Track the goals and their status in order to publish status...
  this.statusMessage = new Message({
    header: {
      stamp: { secs: 0, nsecs: 100 },
      frame_id: "",
    },
    status_list: [],
  });

  // needed for handling preemption prompted by a new goal being received
  this.currentGoal = null; // currently tracked goal
  this.nextGoal = null; // the one that'll be preempting

  goalListener.subscribe(function (goalMessage) {
    if (that.currentGoal) {
      that.nextGoal = goalMessage;
      // needs to happen AFTER rest is set up
      that.emit("cancel");
    } else {
      that.statusMessage.status_list = [
        { goal_id: goalMessage.goal_id, status: 1 },
      ];
      that.currentGoal = goalMessage;
      that.emit("goal", goalMessage.goal);
    }
  });

  // helper function for determing ordering of timestamps
  // returns t1 < t2
  var isEarlier = function (t1, t2) {
    if (t1.secs > t2.secs) {
      return false;
    } else if (t1.secs < t2.secs) {
      return true;
    } else if (t1.nsecs < t2.nsecs) {
      return true;
    } else {
      return false;
    }
  };

  // TODO: this may be more complicated than necessary, since I'm
  // not sure if the callbacks can ever wind up with a scenario
  // where we've been preempted by a next goal, it hasn't finished
  // processing, and then we get a cancel message
  cancelListener.subscribe(function (cancelMessage) {
    // cancel ALL goals if both empty
    if (
      cancelMessage.stamp.secs === 0 &&
      cancelMessage.stamp.secs === 0 &&
      cancelMessage.id === ""
    ) {
      that.nextGoal = null;
      if (that.currentGoal) {
        that.emit("cancel");
      }
    } else {
      // treat id and stamp independently
      if (
        that.currentGoal &&
        cancelMessage.id === that.currentGoal.goal_id.id
      ) {
        that.emit("cancel");
      } else if (
        that.nextGoal &&
        cancelMessage.id === that.nextGoal.goal_id.id
      ) {
        that.nextGoal = null;
      }

      if (
        that.nextGoal &&
        isEarlier(that.nextGoal.goal_id.stamp, cancelMessage.stamp)
      ) {
        that.nextGoal = null;
      }
      if (
        that.currentGoal &&
        isEarlier(that.currentGoal.goal_id.stamp, cancelMessage.stamp)
      ) {
        that.emit("cancel");
      }
    }
  });

  // publish status at pseudo-fixed rate; required for clients to know they've connected
  var statusInterval = setInterval(function () {
    var currentTime = new Date();
    var secs = Math.floor(currentTime.getTime() / 1000);
    var nsecs = Math.round(1000000000 * (currentTime.getTime() / 1000 - secs));
    that.statusMessage.header.stamp.secs = secs;
    that.statusMessage.header.stamp.nsecs = nsecs;
    statusPublisher.publish(that.statusMessage);
  }, 500); // publish every 500ms
}

SimpleActionServer.prototype.__proto__ = EventEmitter2.prototype;

/**
 *  Set action state to succeeded and return to client
 */

SimpleActionServer.prototype.setSucceeded = function (result2) {
  var resultMessage = new Message({
    status: { goal_id: this.currentGoal.goal_id, status: 3 },
    result: result2,
  });
  this.resultPublisher.publish(resultMessage);

  this.statusMessage.status_list = [];
  if (this.nextGoal) {
    this.currentGoal = this.nextGoal;
    this.nextGoal = null;
    this.emit("goal", this.currentGoal.goal);
  } else {
    this.currentGoal = null;
  }
};

/**
 *  Set action state to aborted and return to client
 */

SimpleActionServer.prototype.setAborted = function (result2) {
  var resultMessage = new Message({
    status: { goal_id: this.currentGoal.goal_id, status: 4 },
    result: result2,
  });
  this.resultPublisher.publish(resultMessage);

  this.statusMessage.status_list = [];
  if (this.nextGoal) {
    this.currentGoal = this.nextGoal;
    this.nextGoal = null;
    this.emit("goal", this.currentGoal.goal);
  } else {
    this.currentGoal = null;
  }
};

/**
 *  Function to send feedback
 */

SimpleActionServer.prototype.sendFeedback = function (feedback2) {
  var feedbackMessage = new Message({
    status: { goal_id: this.currentGoal.goal_id, status: 1 },
    feedback: feedback2,
  });
  this.feedbackPublisher.publish(feedbackMessage);
};

/**
 *  Handle case where client requests preemption
 */

SimpleActionServer.prototype.setPreempted = function () {
  this.statusMessage.status_list = [];
  var resultMessage = new Message({
    status: { goal_id: this.currentGoal.goal_id, status: 2 },
  });
  this.resultPublisher.publish(resultMessage);

  if (this.nextGoal) {
    this.currentGoal = this.nextGoal;
    this.nextGoal = null;
    this.emit("goal", this.currentGoal.goal);
  } else {
    this.currentGoal = null;
  }
};

export default SimpleActionServer;
